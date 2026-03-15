import { json } from "@remix-run/node";
import { getAppSettings, getFeeRules } from "../db.server.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json(
      { error: "Pass ?shop=yourstore.myshopify.com to this URL" },
      { headers: corsHeaders }
    );
  }

  try {
    const settings = await getAppSettings(shop);
    const rules = await getFeeRules(shop);

    return json(
      {
        shop,
        settings: {
          app_enabled: settings.app_enabled,
          handling_fee_variant_gid: settings.handling_fee_variant_gid,
          handling_fee_product_gid: settings.handling_fee_product_gid,
          conflict_resolution: settings.conflict_resolution,
          default_fee_label: settings.default_fee_label,
        },
        rules: rules.map((r) => ({
          id: r.id,
          rule_type: r.rule_type,
          shopify_id: r.shopify_id,
          shopify_title: r.shopify_title,
          fee_amount: r.fee_amount,
          fee_type: r.fee_type,
          is_active: r.is_active,
        })),
        issues: [
          !settings.app_enabled && "⚠ app_enabled is FALSE — no fees will apply",
          !settings.handling_fee_variant_gid &&
            "⚠ handling_fee_variant_gid is NULL — go to Settings and click Create Handling Fee Product",
          rules.length === 0 && "⚠ No fee rules found for this shop",
          rules.filter((r) => r.is_active).length === 0 &&
            rules.length > 0 &&
            "⚠ Fee rules exist but none are active",
        ].filter(Boolean),
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    return json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
}
