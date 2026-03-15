import { useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Tabs,
  DataTable,
  Badge,
  Modal,
  FormLayout,
  TextField,
  Select,
  Thumbnail,
  EmptyState,
  Toast,
  Frame,
  Box,
  Divider,
  Icon,
} from "@shopify/polaris";
import { SearchIcon, DeleteIcon, EditIcon, PlusIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server.js";
import {
  getFeeRules,
  upsertFeeRule,
  deleteFeeRule,
  toggleFeeRule,
} from "../db.server.js";

const PRODUCTS_QUERY = `
  query getProducts($query: String, $first: Int!) {
    products(query: $query, first: $first) {
      edges {
        node {
          id
          title
          handle
          featuredImage { url }
          variants(first: 1) {
            edges {
              node { id price }
            }
          }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query getCollections($query: String, $first: Int!) {
    collections(query: $query, first: $first) {
      edges {
        node {
          id
          title
          handle
          image { url }
          productsCount { count }
        }
      }
    }
  }
`;

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const rules = await getFeeRules(session.shop);
    return json({ rules, shopDomain: session.shop });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Fees loader error:", err);
    throw err;
  }
}

export async function action({ request }) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "upsert") {
      const rule = {
        rule_type: formData.get("rule_type"),
        shopify_id: formData.get("shopify_id"),
        shopify_title: formData.get("shopify_title"),
        shopify_image_url: formData.get("shopify_image_url") || null,
        fee_amount: parseFloat(formData.get("fee_amount")),
        fee_type: formData.get("fee_type"),
        fee_label: formData.get("fee_label"),
        is_active: formData.get("is_active") === "true",
        priority: parseInt(formData.get("priority") || "0"),
      };
      if (isNaN(rule.fee_amount) || rule.fee_amount < 0) {
        return json({ error: "Invalid fee amount" }, { status: 400 });
      }
      const result = await upsertFeeRule(shopDomain, rule);
      return json({ success: true, rule: result });
    }

    if (intent === "delete") {
      await deleteFeeRule(shopDomain, formData.get("rule_id"));
      return json({ success: true });
    }

    if (intent === "toggle") {
      const result = await toggleFeeRule(
        shopDomain,
        formData.get("rule_id"),
        formData.get("is_active") === "true"
      );
      return json({ success: true, rule: result });
    }

    if (intent === "search_products") {
      const response = await admin.graphql(PRODUCTS_QUERY, {
        variables: { query: formData.get("query") || "", first: 20 },
      });
      const data = await response.json();
      const products = data.data.products.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        imageUrl: node.featuredImage?.url,
        price: node.variants.edges[0]?.node?.price,
      }));
      return json({ products });
    }

    if (intent === "search_collections") {
      const response = await admin.graphql(COLLECTIONS_QUERY, {
        variables: { query: formData.get("query") || "", first: 20 },
      });
      const data = await response.json();
      const collections = data.data.collections.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        imageUrl: node.image?.url,
        productsCount: node.productsCount?.count,
      }));
      return json({ collections });
    }

    return json({ error: "Unknown intent" }, { status: 400 });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Fees action error:", err);
    return json({ error: err.message }, { status: 500 });
  }
}

export default function FeesPage() {
  const { rules } = useLoaderData();
  const fetcher = useFetcher();
  const submit = useSubmit();

  const [selectedTab, setSelectedTab] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState(null);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedResource, setSelectedResource] = useState(null);
  const [formValues, setFormValues] = useState({
    rule_type: "product",
    fee_amount: "",
    fee_type: "fixed",
    fee_label: "Handling Fee",
    is_active: true,
    priority: "0",
  });
  const [formErrors, setFormErrors] = useState({});

  const tabs = [
    { id: "all", content: `All Rules (${rules.length})`, panelID: "all" },
    {
      id: "products",
      content: `Products (${rules.filter((r) => r.rule_type === "product").length})`,
      panelID: "products",
    },
    {
      id: "collections",
      content: `Collections (${rules.filter((r) => r.rule_type === "collection").length})`,
      panelID: "collections",
    },
  ];

  const filteredRules =
    selectedTab === 0
      ? rules
      : selectedTab === 1
      ? rules.filter((r) => r.rule_type === "product")
      : rules.filter((r) => r.rule_type === "collection");

  function showToast(message) {
    setToastMessage(message);
    setToastActive(true);
  }

  function openAddModal(type = "product") {
    setEditingRule(null);
    setSelectedResource(null);
    setSearchQuery("");
    setSearchResults([]);
    setFormValues({
      rule_type: type,
      fee_amount: "",
      fee_type: "fixed",
      fee_label: "Handling Fee",
      is_active: true,
      priority: "0",
    });
    setFormErrors({});
    setModalOpen(true);
  }

  function openEditModal(rule) {
    setEditingRule(rule);
    setSelectedResource({
      id: rule.shopify_id,
      title: rule.shopify_title,
      imageUrl: rule.shopify_image_url,
    });
    setFormValues({
      rule_type: rule.rule_type,
      fee_amount: String(rule.fee_amount),
      fee_type: rule.fee_type,
      fee_label: rule.fee_label,
      is_active: rule.is_active,
      priority: String(rule.priority),
    });
    setFormErrors({});
    setModalOpen(true);
  }

  function handleSearch(query) {
    setSearchQuery(query);
    setSelectedResource(null);
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    const fd = new FormData();
    fd.append(
      "intent",
      formValues.rule_type === "product" ? "search_products" : "search_collections"
    );
    fd.append("query", query);
    fetcher.submit(fd, { method: "post" });
  }

  const fetcherProducts = fetcher.data?.products;
  const fetcherCollections = fetcher.data?.collections;
  if (fetcherProducts && fetcherProducts !== searchResults) {
    setSearchResults(fetcherProducts);
  }
  if (fetcherCollections && fetcherCollections !== searchResults) {
    setSearchResults(fetcherCollections);
  }

  function validateForm() {
    const errors = {};
    if (!selectedResource && !editingRule) {
      errors.resource = `Please select a ${formValues.rule_type}`;
    }
    if (!formValues.fee_amount || isNaN(parseFloat(formValues.fee_amount))) {
      errors.fee_amount = "Please enter a valid fee amount";
    }
    if (parseFloat(formValues.fee_amount) < 0) {
      errors.fee_amount = "Fee amount must be positive";
    }
    if (!formValues.fee_label.trim()) {
      errors.fee_label = "Please enter a fee label";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSave() {
    if (!validateForm()) return;
    const resource = selectedResource || {
      id: editingRule?.shopify_id,
      title: editingRule?.shopify_title,
      imageUrl: editingRule?.shopify_image_url,
    };
    const fd = new FormData();
    fd.append("intent", "upsert");
    fd.append("rule_type", formValues.rule_type);
    fd.append("shopify_id", resource.id);
    fd.append("shopify_title", resource.title);
    fd.append("shopify_image_url", resource.imageUrl || "");
    fd.append("fee_amount", formValues.fee_amount);
    fd.append("fee_type", formValues.fee_type);
    fd.append("fee_label", formValues.fee_label);
    fd.append("is_active", String(formValues.is_active));
    fd.append("priority", formValues.priority);
    submit(fd, { method: "post" });
    setModalOpen(false);
    showToast(editingRule ? "Fee rule updated" : "Fee rule created");
  }

  function handleDelete(ruleId) {
    setDeletingRuleId(ruleId);
    setDeleteModalOpen(true);
  }

  function confirmDelete() {
    const fd = new FormData();
    fd.append("intent", "delete");
    fd.append("rule_id", deletingRuleId);
    submit(fd, { method: "post" });
    setDeleteModalOpen(false);
    showToast("Fee rule deleted");
  }

  function handleToggle(rule) {
    const fd = new FormData();
    fd.append("intent", "toggle");
    fd.append("rule_id", rule.id);
    fd.append("is_active", String(!rule.is_active));
    submit(fd, { method: "post" });
    showToast(`Rule ${!rule.is_active ? "enabled" : "disabled"}`);
  }

  const rows = filteredRules.map((rule) => [
    <InlineStack gap="300" blockAlign="center">
      {rule.shopify_image_url ? (
        <Thumbnail source={rule.shopify_image_url} size="small" alt="" />
      ) : (
        <Box width="40px" minHeight="40px" background="bg-surface-secondary" borderRadius="100" />
      )}
      <BlockStack gap="050">
        <Text variant="bodyMd" fontWeight="semibold">{rule.shopify_title}</Text>
      </BlockStack>
    </InlineStack>,
    <Badge tone={rule.rule_type === "product" ? "info" : "attention"}>
      {rule.rule_type === "product" ? "Product" : "Collection"}
    </Badge>,
    <BlockStack gap="050">
      <Text fontWeight="semibold">
        {rule.fee_type === "fixed"
          ? `$${parseFloat(rule.fee_amount).toFixed(2)}`
          : `${rule.fee_amount}%`}
      </Text>
      <Text variant="bodySm" tone="subdued">
        {rule.fee_type === "fixed" ? "Fixed amount" : "Percentage"}
      </Text>
    </BlockStack>,
    rule.fee_label,
    <Button variant="plain" onClick={() => handleToggle(rule)}>
      <Badge tone={rule.is_active ? "success" : "critical"}>
        {rule.is_active ? "Active" : "Inactive"}
      </Badge>
    </Button>,
    <InlineStack gap="200">
      <Button variant="plain" icon={EditIcon} onClick={() => openEditModal(rule)} accessibilityLabel="Edit" />
      <Button variant="plain" tone="critical" icon={DeleteIcon} onClick={() => handleDelete(rule.id)} accessibilityLabel="Delete" />
    </InlineStack>,
  ]);

  return (
    <Frame>
      <Page
        title="Fee Rules"
        subtitle="Set handling fees per product or collection"
        primaryAction={
          <Button variant="primary" icon={PlusIcon} onClick={() => openAddModal("product")}>
            Add Product Fee
          </Button>
        }
        secondaryActions={[
          { content: "Add Collection Fee", onAction: () => openAddModal("collection") },
        ]}
      >
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                <Box padding="0">
                  {filteredRules.length === 0 ? (
                    <Box padding="800">
                      <EmptyState
                        heading={
                          selectedTab === 2 ? "No collection fee rules" :
                          selectedTab === 1 ? "No product fee rules" :
                          "No fee rules yet"
                        }
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                        action={{
                          content: selectedTab === 2 ? "Add Collection Fee" : "Add Product Fee",
                          onAction: () => openAddModal(selectedTab === 2 ? "collection" : "product"),
                        }}
                      >
                        <p>
                          {selectedTab === 2
                            ? "Apply a handling fee to all products in a collection."
                            : "Apply a handling fee to a specific product."}
                        </p>
                      </EmptyState>
                    </Box>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                      headings={["Product / Collection", "Type", "Fee", "Label", "Status", "Actions"]}
                      rows={rows}
                    />
                  )}
                </Box>
              </Tabs>
            </Card>
          </Layout.Section>
        </Layout>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editingRule ? "Edit Fee Rule" : "Add Fee Rule"}
          primaryAction={{ content: editingRule ? "Save Changes" : "Add Rule", onAction: handleSave }}
          secondaryActions={[{ content: "Cancel", onAction: () => setModalOpen(false) }]}
        >
          <Modal.Section>
            <FormLayout>
              <Select
                label="Apply fee to"
                options={[
                  { label: "Specific Product", value: "product" },
                  { label: "Entire Collection", value: "collection" },
                ]}
                value={formValues.rule_type}
                onChange={(value) => {
                  setFormValues((v) => ({ ...v, rule_type: value }));
                  setSelectedResource(null);
                  setSearchResults([]);
                  setSearchQuery("");
                }}
                disabled={!!editingRule}
              />

              {!editingRule ? (
                <BlockStack gap="200">
                  <TextField
                    label={formValues.rule_type === "product" ? "Search Products" : "Search Collections"}
                    value={searchQuery}
                    onChange={handleSearch}
                    placeholder={formValues.rule_type === "product" ? "Start typing a product name..." : "Start typing a collection name..."}
                    prefix={<Icon source={SearchIcon} />}
                    error={formErrors.resource}
                    autoComplete="off"
                  />
                  {searchResults.length > 0 && !selectedResource && (
                    <Card padding="0">
                      {searchResults.map((result) => (
                        <Box key={result.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                          <button
                            onClick={() => {
                              setSelectedResource(result);
                              setSearchQuery(result.title);
                              setSearchResults([]);
                              setFormErrors((e) => ({ ...e, resource: null }));
                            }}
                            style={{ background: "none", border: "none", width: "100%", cursor: "pointer", textAlign: "left" }}
                          >
                            <InlineStack gap="300" blockAlign="center">
                              {result.imageUrl && <Thumbnail source={result.imageUrl} size="small" alt="" />}
                              <BlockStack gap="050">
                                <Text fontWeight="semibold">{result.title}</Text>
                                {result.price && <Text tone="subdued">${result.price}</Text>}
                                {result.productsCount !== undefined && <Text tone="subdued">{result.productsCount} products</Text>}
                              </BlockStack>
                            </InlineStack>
                          </button>
                        </Box>
                      ))}
                    </Card>
                  )}
                  {selectedResource && (
                    <Card>
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                          {selectedResource.imageUrl && <Thumbnail source={selectedResource.imageUrl} size="small" alt="" />}
                          <Text fontWeight="semibold">{selectedResource.title}</Text>
                        </InlineStack>
                        <Button variant="plain" tone="critical" onClick={() => { setSelectedResource(null); setSearchQuery(""); }}>
                          Remove
                        </Button>
                      </InlineStack>
                    </Card>
                  )}
                </BlockStack>
              ) : (
                <Card>
                  <InlineStack gap="300" blockAlign="center">
                    {editingRule.shopify_image_url && <Thumbnail source={editingRule.shopify_image_url} size="small" alt="" />}
                    <Text fontWeight="semibold">{editingRule.shopify_title}</Text>
                  </InlineStack>
                </Card>
              )}

              <Divider />

              <Select
                label="Fee type"
                options={[
                  { label: "Fixed amount (e.g. $5.00 per item)", value: "fixed" },
                  { label: "Percentage of item price (e.g. 5%)", value: "percentage" },
                ]}
                value={formValues.fee_type}
                onChange={(value) => setFormValues((v) => ({ ...v, fee_type: value }))}
              />

              <TextField
                label="Fee amount"
                type="number"
                value={formValues.fee_amount}
                onChange={(value) => setFormValues((v) => ({ ...v, fee_amount: value }))}
                prefix={formValues.fee_type === "fixed" ? "$" : ""}
                suffix={formValues.fee_type === "percentage" ? "%" : ""}
                error={formErrors.fee_amount}
                placeholder={formValues.fee_type === "fixed" ? "5.00" : "5"}
                autoComplete="off"
                helpText={formValues.fee_type === "fixed" ? "Added per item in the cart" : "Percentage of item price, per item"}
              />

              <TextField
                label="Fee label (shown at checkout)"
                value={formValues.fee_label}
                onChange={(value) => setFormValues((v) => ({ ...v, fee_label: value }))}
                error={formErrors.fee_label}
                placeholder="Handling Fee"
                autoComplete="off"
                helpText="What customers see at checkout"
              />

              <TextField
                label="Priority"
                type="number"
                value={formValues.priority}
                onChange={(value) => setFormValues((v) => ({ ...v, priority: value }))}
                helpText="Higher number = higher priority when multiple rules match"
                autoComplete="off"
              />

              <Select
                label="Status"
                options={[
                  { label: "Active", value: "true" },
                  { label: "Inactive", value: "false" },
                ]}
                value={String(formValues.is_active)}
                onChange={(value) => setFormValues((v) => ({ ...v, is_active: value === "true" }))}
              />
            </FormLayout>
          </Modal.Section>
        </Modal>

        <Modal
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          title="Delete fee rule?"
          primaryAction={{ content: "Delete", destructive: true, onAction: confirmDelete }}
          secondaryActions={[{ content: "Cancel", onAction: () => setDeleteModalOpen(false) }]}
        >
          <Modal.Section>
            <Text>This fee rule will be permanently deleted.</Text>
          </Modal.Section>
        </Modal>

        {toastActive && (
          <Toast content={toastMessage} onDismiss={() => setToastActive(false)} />
        )}
      </Page>
    </Frame>
  );
}
