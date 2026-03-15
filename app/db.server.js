import { createClient } from "@supabase/supabase-js";
import { Session } from "@shopify/shopify-api";

if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ============================================================
// Shopify Session Storage using Supabase
// ============================================================
export const sessionStorage = {
  async storeSession(session) {
    const { error } = await supabase.from("shopify_sessions").upsert(
      {
        id: session.id,
        shop: session.shop,
        state: session.state,
        is_online: session.isOnline,
        scope: session.scope,
        expires: session.expires?.toISOString(),
        access_token: session.accessToken,
        user_id: session.onlineAccessInfo?.associated_user?.id,
        first_name: session.onlineAccessInfo?.associated_user?.first_name,
        last_name: session.onlineAccessInfo?.associated_user?.last_name,
        email: session.onlineAccessInfo?.associated_user?.email,
        account_owner:
          session.onlineAccessInfo?.associated_user?.account_owner,
        locale: session.onlineAccessInfo?.associated_user?.locale,
        collaborator:
          session.onlineAccessInfo?.associated_user?.collaborator,
        email_verified:
          session.onlineAccessInfo?.associated_user?.email_verified,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) throw error;
    return true;
  },

  async loadSession(id) {
    const { data, error } = await supabase
      .from("shopify_sessions")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return undefined;
    return rowToSession(data);
  },

  async deleteSession(id) {
    const { error } = await supabase
      .from("shopify_sessions")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return true;
  },

  async deleteSessions(ids) {
    const { error } = await supabase
      .from("shopify_sessions")
      .delete()
      .in("id", ids);
    if (error) throw error;
    return true;
  },

  async findSessionsByShop(shop) {
    const { data, error } = await supabase
      .from("shopify_sessions")
      .select("*")
      .eq("shop", shop);
    if (error) return [];
    return data.map(rowToSession);
  },
};

// ============================================================
// Convert DB row to proper Shopify Session instance
// IMPORTANT: Must return a Session class instance, not a plain object
// Plain objects are missing isActive() and other methods Shopify needs
// ============================================================
function rowToSession(row) {
  const session = new Session({
    id: row.id,
    shop: row.shop,
    state: row.state || "",
    isOnline: row.is_online || false,
  });

  session.scope = row.scope;
  session.expires = row.expires ? new Date(row.expires) : undefined;
  session.accessToken = row.access_token;

  if (row.user_id) {
    session.onlineAccessInfo = {
      associated_user_scope: row.scope,
      associated_user: {
        id: row.user_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        account_owner: row.account_owner,
        locale: row.locale,
        collaborator: row.collaborator,
        email_verified: row.email_verified,
      },
    };
  }

  return session;
}

// ============================================================
// Fee Rules CRUD
// ============================================================
export async function getFeeRules(shopDomain) {
  const { data, error } = await supabase
    .from("fee_rules")
    .select("*")
    .eq("shop_domain", shopDomain)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function upsertFeeRule(shopDomain, rule) {
  const { data, error } = await supabase
    .from("fee_rules")
    .upsert(
      {
        shop_domain: shopDomain,
        rule_type: rule.rule_type,
        shopify_id: rule.shopify_id,
        shopify_title: rule.shopify_title,
        shopify_image_url: rule.shopify_image_url,
        fee_amount: parseFloat(rule.fee_amount),
        fee_type: rule.fee_type || "fixed",
        fee_label: rule.fee_label || "Handling Fee",
        is_active: rule.is_active !== false,
        priority: rule.priority || 0,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "shop_domain,rule_type,shopify_id",
        ignoreDuplicates: false,
      }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteFeeRule(shopDomain, ruleId) {
  const { error } = await supabase
    .from("fee_rules")
    .delete()
    .eq("id", ruleId)
    .eq("shop_domain", shopDomain);

  if (error) throw error;
  return true;
}

export async function toggleFeeRule(shopDomain, ruleId, isActive) {
  const { data, error } = await supabase
    .from("fee_rules")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", ruleId)
    .eq("shop_domain", shopDomain)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================
// App Settings CRUD
// ============================================================
export async function getAppSettings(shopDomain) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("shop_domain", shopDomain)
    .single();

  if (error && error.code !== "PGRST116") throw error;

  if (!data) {
    const { data: newData, error: createError } = await supabase
      .from("app_settings")
      .insert({ shop_domain: shopDomain })
      .select()
      .single();
    if (createError) throw createError;
    return newData;
  }

  return data;
}

export async function updateAppSettings(shopDomain, settings) {
  const { data, error } = await supabase
    .from("app_settings")
    .upsert(
      {
        shop_domain: shopDomain,
        ...settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_domain" }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================
// Resolve fees for checkout extension
// ============================================================
export async function resolveFeesForCart(shopDomain, cartItems) {
  const settings = await getAppSettings(shopDomain);
  if (!settings.app_enabled) return [];

  const { data: rules, error } = await supabase
    .from("fee_rules")
    .select("*")
    .eq("shop_domain", shopDomain)
    .eq("is_active", true);

  if (error || !rules) return [];

  const productRules = rules.filter((r) => r.rule_type === "product");
  const collectionRules = rules.filter((r) => r.rule_type === "collection");
  const feesToApply = [];

  for (const item of cartItems) {
    const matchedProductRule = productRules.find(
      (r) =>
        r.shopify_id === item.productId ||
        r.shopify_id === `gid://shopify/Product/${item.productId}`
    );

    const matchedCollectionRules = collectionRules.filter(
      (r) =>
        item.collectionIds?.includes(r.shopify_id) ||
        item.collectionIds?.includes(
          r.shopify_id.replace("gid://shopify/Collection/", "")
        )
    );

    let applicableRules = [];

    if (matchedProductRule) {
      switch (settings.conflict_resolution) {
        case "product":
          applicableRules = [matchedProductRule];
          break;
        case "collection":
          applicableRules =
            matchedCollectionRules.length > 0
              ? matchedCollectionRules
              : [matchedProductRule];
          break;
        case "sum":
          applicableRules = [matchedProductRule, ...matchedCollectionRules];
          break;
        case "lowest": {
          const all = [matchedProductRule, ...matchedCollectionRules];
          applicableRules = [all.reduce((p, c) => c.fee_amount < p.fee_amount ? c : p)];
          break;
        }
        default: {
          const all = [matchedProductRule, ...matchedCollectionRules];
          applicableRules = [all.reduce((p, c) => c.fee_amount > p.fee_amount ? c : p)];
        }
      }
    } else if (matchedCollectionRules.length > 0) {
      if (settings.conflict_resolution === "sum") {
        applicableRules = matchedCollectionRules;
      } else {
        applicableRules = [matchedCollectionRules.reduce((p, c) => c.fee_amount > p.fee_amount ? c : p)];
      }
    }

    for (const rule of applicableRules) {
      const feeAmount =
        rule.fee_type === "percentage"
          ? ((item.price * rule.fee_amount) / 100) * item.quantity
          : rule.fee_amount * item.quantity;

      feesToApply.push({
        label: rule.fee_label || settings.default_fee_label || "Handling Fee",
        amount: feeAmount,
        feeType: rule.fee_type,
        ruleId: rule.id,
      });
    }
  }

  return feesToApply.reduce((acc, fee) => {
    const existing = acc.find((f) => f.label === fee.label);
    if (existing) {
      existing.amount += fee.amount;
    } else {
      acc.push({ ...fee });
    }
    return acc;
  }, []);
}
