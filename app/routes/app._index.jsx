import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Badge,
  Button,
  Box,
  Banner,
  DataTable,
  EmptyState,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { getFeeRules, getAppSettings } from "../db.server.js";

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const [rules, settings] = await Promise.all([
      getFeeRules(shopDomain),
      getAppSettings(shopDomain),
    ]);

    const activeRules = rules.filter((r) => r.is_active);
    const productRules = rules.filter((r) => r.rule_type === "product");
    const collectionRules = rules.filter((r) => r.rule_type === "collection");

    return json({
      shopDomain,
      totalRules: rules.length,
      activeRules: activeRules.length,
      productRules: productRules.length,
      collectionRules: collectionRules.length,
      recentRules: rules.slice(0, 5),
      settings,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Dashboard loader error:", err);
    throw err;
  }
}

export default function Index() {
  const {
    shopDomain,
    totalRules,
    activeRules,
    productRules,
    collectionRules,
    recentRules,
    settings,
  } = useLoaderData();

  const rows = recentRules.map((rule) => [
    <InlineStack gap="200" blockAlign="center">
      {rule.shopify_image_url && (
        <Thumbnail source={rule.shopify_image_url} size="small" alt="" />
      )}
      <Text>{rule.shopify_title}</Text>
    </InlineStack>,
    <Badge tone={rule.rule_type === "product" ? "info" : "attention"}>
      {rule.rule_type === "product" ? "Product" : "Collection"}
    </Badge>,
    rule.fee_type === "fixed"
      ? `$${parseFloat(rule.fee_amount).toFixed(2)}`
      : `${rule.fee_amount}%`,
    rule.fee_label,
    <Badge tone={rule.is_active ? "success" : "critical"}>
      {rule.is_active ? "Active" : "Inactive"}
    </Badge>,
  ]);

  return (
    <Page
      title="Handling Fee App"
      subtitle={`Managing fees for ${shopDomain}`}
      primaryAction={
        <Button variant="primary" url="/app/fees">
          Manage Fee Rules
        </Button>
      }
    >
      <Layout>
        {!settings?.handling_fee_product_gid && (
          <Layout.Section>
            <Banner
              title="Setup Required"
              tone="warning"
              action={{ content: "Go to Settings", url: "/app/settings" }}
            >
              <p>
                You need to create a "Handling Fee" product in your Shopify
                store and link it in Settings before fees can be applied at
                checkout.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {settings && !settings.app_enabled && (
          <Layout.Section>
            <Banner title="App is Disabled" tone="critical">
              <p>
                The Handling Fee app is currently disabled. Enable it in
                Settings.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap={false}>
            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2" alignment="center">
                    {totalRules}
                  </Text>
                  <Text variant="bodyMd" as="p" alignment="center" tone="subdued">
                    Total Rules
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2" alignment="center">
                    {activeRules}
                  </Text>
                  <Text variant="bodyMd" as="p" alignment="center" tone="subdued">
                    Active Rules
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2" alignment="center">
                    {productRules}
                  </Text>
                  <Text variant="bodyMd" as="p" alignment="center" tone="subdued">
                    Product Rules
                  </Text>
                </BlockStack>
              </Card>
            </Box>
            <Box width="25%">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2" alignment="center">
                    {collectionRules}
                  </Text>
                  <Text variant="bodyMd" as="p" alignment="center" tone="subdued">
                    Collection Rules
                  </Text>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Recent Fee Rules
                </Text>
                <Button url="/app/fees" variant="plain">
                  View All
                </Button>
              </InlineStack>
              {recentRules.length === 0 ? (
                <EmptyState
                  heading="No fee rules yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{ content: "Add Fee Rule", url: "/app/fees" }}
                >
                  <p>
                    Add handling fees to specific products or entire collections.
                  </p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Product / Collection", "Type", "Fee Amount", "Label", "Status"]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                How It Works
              </Text>
              <BlockStack gap="200">
                <InlineStack gap="200">
                  <Badge>1</Badge>
                  <Text>Create fee rules for individual products or entire collections</Text>
                </InlineStack>
                <InlineStack gap="200">
                  <Badge>2</Badge>
                  <Text>The checkout extension automatically detects matching products in the cart</Text>
                </InlineStack>
                <InlineStack gap="200">
                  <Badge>3</Badge>
                  <Text>A handling fee line item is added to the order at checkout</Text>
                </InlineStack>
                <InlineStack gap="200">
                  <Badge>4</Badge>
                  <Text>Customers see the handling fee clearly labeled before completing their purchase</Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
