import { json } from "@remix-run/node";
import { resolveFeesForCart, getAppSettings } from "../db.server.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Shop-Domain",
  "Content-Type": "application/json",
};

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

    return json(
      {
        fees,
        variantGid: settings.handling_fee_variant_gid || null,
        productGid: settings.handling_fee_product_gid || null,
        totalFee,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("Fee resolution error:", err);
    return json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
