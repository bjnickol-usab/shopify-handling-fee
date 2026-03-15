import { json } from "@remix-run/node";
import { resolveFeesForCart, getAppSettings, sessionStorage } from "../db.server.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Shop-Domain",
  "Content-Type": "application/json",
};

const UPDATE_VARIANT_PRICE_MUTATION = `
  mutation updateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function updateVariantPrice(accessToken, shopDomain, productGid, variantGid, price) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/2025-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: UPDATE_VARIANT_PRICE_MUTATION,
        variables: {
          productId: productGid,
          variants: [
            {
              id: variantGid,
              price: price.toFixed(2),
            },
          ],
        },
      }),
    }
  );
  const data = await response.json();
  if (data.errors) {
    console.error("GraphQL errors updating variant price:", data.errors);
    return false;
  }
  if (data.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
    console.error("User errors updating variant price:", data.data.productVariantsBulkUpdate.userErrors);
    return false;
  }
  return true;
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return json({ status: "Fee API is running" });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { shopDomain, cartItems } = body;

    if (!shopDomain) {
      return json({ error: "shopDomain is required" }, { status: 400, headers: corsHeaders });
    }

    if (!cartItems || !Array.isArray(cartItems)) {
      return json({ error: "cartItems must be an array" }, { status: 400, headers: corsHeaders });
    }

    const settings = await getAppSettings(shopDomain);

    if (!settings.app_enabled) {
      return json({ fees: [], variantGid: null, totalFee: 0 }, { headers: corsHeaders });
    }

    const fees = await resolveFeesForCart(shopDomain, cartItems);
    const totalFee = Math.round(fees.reduce((sum, f) => sum + f.amount, 0) * 100) / 100;

    const variantGid = settings.handling_fee_variant_gid || null;
    const productGid = settings.handling_fee_product_gid || null;

    // Update the variant price to match the total fee so Shopify charges correctly
    if (variantGid && productGid && totalFee > 0) {
      try {
        const sessions = await sessionStorage.findSessionsByShop(shopDomain);
        // Use the offline session (no user_id) which has a long-lived token
        const offlineSession = sessions.find((s) => !s.isOnline) || sessions[0];
        if (offlineSession?.accessToken) {
          await updateVariantPrice(
            offlineSession.accessToken,
            shopDomain,
            productGid,
            variantGid,
            totalFee
          );
        } else {
          console.warn("No offline session found for shop:", shopDomain);
        }
      } catch (err) {
        console.error("Error updating variant price:", err);
        // Don't fail the whole request — return fees even if price update fails
      }
    }

    return json(
      {
        fees,
        variantGid,
        productGid,
        totalFee,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("Fee resolution error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
