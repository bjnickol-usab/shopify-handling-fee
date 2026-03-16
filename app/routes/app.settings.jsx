import { useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Select,
  TextField,
  Button,
  Banner,
  Divider,
  Toast,
  Frame,
  FormLayout,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { getAppSettings, updateAppSettings } from "../db.server.js";

const CREATE_PRODUCT_MUTATION = `
  mutation createHandlingFeeProduct {
    productCreate(input: {
      title: "Handling Fee",
      status: ACTIVE,
      productType: "Service",
      vendor: "Handling Fee App"
    }) {
      product {
        id
        title
        variants(first: 1) {
          edges {
            node {
              id
              price
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_VARIANT_MUTATION = `
  mutation updateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
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

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const settings = await getAppSettings(session.shop);
    return json({ settings, shopDomain: session.shop });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Settings loader error:", err);
    throw err;
  }
}

export async function action({ request }) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "save_settings") {
      const result = await updateAppSettings(shopDomain, {
        default_fee_label: formData.get("default_fee_label"),
        app_enabled: formData.get("app_enabled") === "true",
        conflict_resolution: formData.get("conflict_resolution"),
      });
      return json({ success: true, settings: result });
    }

    if (intent === "update_fee_price") {
      const settings = await getAppSettings(shopDomain);
      if (!settings.handling_fee_product_gid || !settings.handling_fee_variant_gid) {
        return json({ error: "Handling Fee product not set up yet. Create it first." }, { status: 400 });
      }
      const price = parseFloat(formData.get("fee_price"));
      if (isNaN(price) || price < 0) {
        return json({ error: "Invalid price amount." }, { status: 400 });
      }
      const response = await admin.graphql(UPDATE_VARIANT_MUTATION, {
        variables: {
          productId: settings.handling_fee_product_gid,
          variants: [{ id: settings.handling_fee_variant_gid, price: price.toFixed(2) }],
        },
      });
      const data = await response.json();
      if (data.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
        return json({ error: data.data.productVariantsBulkUpdate.userErrors[0].message }, { status: 400 });
      }
      const updatedPrice = data.data?.productVariantsBulkUpdate?.productVariants?.[0]?.price;
      return json({ success: true, updatedPrice });
    }

    if (intent === "create_fee_product") {
      const createResponse = await admin.graphql(CREATE_PRODUCT_MUTATION);
      const createData = await createResponse.json();

      if (createData.data?.productCreate?.userErrors?.length > 0) {
        return json({ error: createData.data.productCreate.userErrors[0].message }, { status: 400 });
      }

      const product = createData.data?.productCreate?.product;
      if (!product) {
        return json({ error: "Product creation failed — no product returned." }, { status: 400 });
      }

      const variantId = product.variants.edges[0]?.node?.id;

      // Set price to $0.00 initially
      if (variantId) {
        await admin.graphql(UPDATE_VARIANT_MUTATION, {
          variables: {
            productId: product.id,
            variants: [{ id: variantId, price: "0.00" }],
          },
        });
      }

      await updateAppSettings(shopDomain, {
        handling_fee_product_gid: product.id,
        handling_fee_variant_gid: variantId,
      });

      return json({ success: true, productId: product.id, variantId, productTitle: product.title });
    }

    return json({ error: "Unknown intent" }, { status: 400 });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Settings action error:", err);
    return json({ error: err.message }, { status: 500 });
  }
}

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const priceFetcher = useFetcher();

  const [appEnabled, setAppEnabled] = useState(settings.app_enabled ?? true);
  const [defaultLabel, setDefaultLabel] = useState(settings.default_fee_label || "Handling Fee");
  const [conflictResolution, setConflictResolution] = useState(settings.conflict_resolution || "highest");
  const [feePrice, setFeePrice] = useState("");
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  function showToast(msg, error = false) {
    setToastMessage(msg);
    setToastError(error);
    setToastActive(true);
  }

  function handleSave() {
    const fd = new FormData();
    fd.append("intent", "save_settings");
    fd.append("app_enabled", String(appEnabled));
    fd.append("default_fee_label", defaultLabel);
    fd.append("conflict_resolution", conflictResolution);
    submit(fd, { method: "post" });
    showToast("Settings saved");
  }

  function handleCreateProduct() {
    const fd = new FormData();
    fd.append("intent", "create_fee_product");
    fetcher.submit(fd, { method: "post" });
  }

  function handleUpdatePrice() {
    if (!feePrice || isNaN(parseFloat(feePrice))) {
      showToast("Please enter a valid price.", true);
      return;
    }
    const fd = new FormData();
    fd.append("intent", "update_fee_price");
    fd.append("fee_price", feePrice);
    priceFetcher.submit(fd, { method: "post" });
  }

  const isCreating = fetcher.state === "submitting" || fetcher.state === "loading";
  const isUpdatingPrice = priceFetcher.state === "submitting" || priceFetcher.state === "loading";

  if (fetcher.state === "idle" && fetcher.data && !toastActive) {
    if (fetcher.data.success) showToast("Handling Fee product created successfully!");
    else if (fetcher.data.error) showToast(`Error: ${fetcher.data.error}`, true);
  }

  if (priceFetcher.state === "idle" && priceFetcher.data && !toastActive) {
    if (priceFetcher.data.success) {
      showToast(`Fee price updated to $${parseFloat(priceFetcher.data.updatedPrice).toFixed(2)}`);
      setFeePrice("");
    } else if (priceFetcher.data.error) {
      showToast(`Error: ${priceFetcher.data.error}`, true);
    }
  }

  const hasProduct = settings.handling_fee_product_gid || fetcher.data?.productId;

  return (
    <Frame>
      <Page
        title="Settings"
        subtitle="Configure how handling fees work in your store"
        primaryAction={{ content: "Save Settings", onAction: handleSave }}
      >
        <Layout>
          {/* ── Product Setup ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Handling Fee Product Setup</Text>
                  <Text tone="subdued">
                    A Shopify product is used to add the handling fee as a line item at checkout.
                    The product price is what customers are charged — set it once here.
                  </Text>
                </BlockStack>

                {hasProduct ? (
                  <Banner tone="success">
                    <BlockStack gap="100">
                      <Text fontWeight="semibold">✓ Handling Fee product is configured</Text>
                      <Text tone="subdued" variant="bodySm">
                        Product GID: {settings.handling_fee_product_gid || fetcher.data?.productId}
                      </Text>
                    </BlockStack>
                  </Banner>
                ) : (
                  <Banner tone={fetcher.data?.error ? "critical" : "warning"}>
                    <BlockStack gap="300">
                      {fetcher.data?.error ? (
                        <Text>Error: {fetcher.data.error}</Text>
                      ) : (
                        <Text>No handling fee product configured. Create one automatically below.</Text>
                      )}
                      <Button
                        variant="primary"
                        onClick={handleCreateProduct}
                        loading={isCreating}
                        disabled={isCreating}
                      >
                        {isCreating ? "Creating..." : "Create Handling Fee Product Automatically"}
                      </Button>
                    </BlockStack>
                  </Banner>
                )}

                {hasProduct && (
                  <>
                    <Divider />
                    <BlockStack gap="200">
                      <Text variant="bodyMd" fontWeight="semibold">Set Handling Fee Price</Text>
                      <Text tone="subdued">
                        This is the fixed amount charged to customers at checkout whenever a fee rule matches.
                        Update it here anytime — no race conditions, no per-checkout price changes.
                      </Text>
                      <InlineStack gap="300" blockAlign="end">
                        <div style={{ width: "160px" }}>
                          <TextField
                            label="Fee amount"
                            type="number"
                            value={feePrice}
                            onChange={setFeePrice}
                            prefix="$"
                            placeholder="e.g. 10.00"
                            autoComplete="off"
                            helpText="Price on the Shopify product variant"
                          />
                        </div>
                        <Button
                          variant="primary"
                          onClick={handleUpdatePrice}
                          loading={isUpdatingPrice}
                          disabled={isUpdatingPrice || !feePrice}
                        >
                          Update Price
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </>
                )}

                <Divider />
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="semibold">Manual Setup Instructions</Text>
                  <Text>1. Go to Products → Add product in Shopify admin</Text>
                  <Text>2. Title it "Handling Fee"</Text>
                  <Text>3. Set the price to your desired fee amount</Text>
                  <Text>4. Uncheck "Requires shipping"</Text>
                  <Text>5. Set inventory tracking to None</Text>
                  <Text>6. Hide from Online Store channel</Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── General Settings ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">General Settings</Text>
                <FormLayout>
                  <Select
                    label="App Status"
                    options={[
                      { label: "Enabled — Fees applied at checkout", value: "true" },
                      { label: "Disabled — No fees applied (rules preserved)", value: "false" },
                    ]}
                    value={String(appEnabled)}
                    onChange={(v) => setAppEnabled(v === "true")}
                    helpText="Quickly enable or disable all handling fees without deleting your rules"
                  />
                  <TextField
                    label="Default fee label"
                    value={defaultLabel}
                    onChange={setDefaultLabel}
                    placeholder="Handling Fee"
                    helpText="What customers see at checkout next to the fee line"
                    autoComplete="off"
                  />
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Conflict Resolution ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Conflict Resolution</Text>
                  <Text tone="subdued">
                    When a product belongs to a collection that has a fee rule AND the product
                    itself has a fee rule, which rule wins?
                  </Text>
                </BlockStack>
                <Select
                  label="When product and collection rules conflict"
                  options={[
                    { label: "Apply the highest fee", value: "highest" },
                    { label: "Apply the lowest fee", value: "lowest" },
                    { label: "Product rule always wins", value: "product" },
                    { label: "Collection rule always wins", value: "collection" },
                    { label: "Add both fees together (sum)", value: "sum" },
                  ]}
                  value={conflictResolution}
                  onChange={setConflictResolution}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Checkout Extension ── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Checkout Extension</Text>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text fontWeight="semibold">Shopify Checkout Extension Required</Text>
                    <Text>
                      This app uses a Shopify Checkout UI Extension to add handling fees.
                      The extension must be activated in your checkout settings.
                    </Text>
                  </BlockStack>
                </Banner>
                <BlockStack gap="100">
                  <Text fontWeight="semibold">Activation Steps:</Text>
                  <Text>1. Go to Settings → Checkout in your Shopify admin</Text>
                  <Text>2. Click Customize under Checkout customization</Text>
                  <Text>3. Find the Handling Fee App extension and enable it</Text>
                  <Text>4. Save your checkout customization</Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {toastActive && (
          <Toast
            content={toastMessage}
            error={toastError}
            onDismiss={() => setToastActive(false)}
          />
        )}
      </Page>
    </Frame>
  );
}
