import { authenticate } from "../shopify.server.js";
import { supabase } from "../db.server.js";

export async function action({ request }) {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await supabase.from("fee_rules").delete().eq("shop_domain", shop);
    await supabase.from("app_settings").delete().eq("shop_domain", shop);
    await supabase.from("shopify_sessions").delete().eq("shop", shop);
    console.log(`Cleaned up data for uninstalled shop: ${shop}`);
  } catch (err) {
    console.error(`Error cleaning up data for ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
}
