import { useState } from "react";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, Form } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
  Text,
  Box,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { login } from "../../shopify.server.js";

export async function loader({ request }) {
  const errors = await login(request).catch(() => ({}));
  return json({ errors: errors || {} });
}

export async function action({ request }) {
  return login(request);
}

export default function Auth() {
  const { errors } = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");

  const fieldError = actionData?.errors?.shop || errors?.shop || undefined;

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page narrowWidth>
        <Box paddingBlockStart="1600">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingLg" as="h1">
                Sign in to Handling Fee App
              </Text>
              <Form method="post">
                <FormLayout>
                  <TextField
                    label="Store domain"
                    type="text"
                    name="shop"
                    value={shop}
                    onChange={setShop}
                    helpText="e.g. your-store.myshopify.com"
                    error={fieldError}
                    autoComplete="off"
                  />
                  <Button variant="primary" submit>
                    Log in
                  </Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Box>
      </Page>
    </AppProvider>
  );
}
