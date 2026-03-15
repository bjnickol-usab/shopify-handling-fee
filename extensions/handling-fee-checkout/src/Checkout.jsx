import { useEffect, useRef, useState } from "react";
import {
  reactExtension,
  useCartLines,
  useApplyCartLinesChange,
  useShop,
  Banner,
  Text,
  BlockStack,
} from "@shopify/ui-extensions-react/checkout";

const APP_URL = "https://shopify-handling-fee.vercel.app";
const DEBUG = true; // Set to false once fees are working

export default reactExtension(
  "purchase.checkout.cart-line-list.render-after",
  () => <HandlingFeeExtension />
);

function HandlingFeeExtension() {
  const cartLines = useCartLines();
  const applyCartLinesChange = useApplyCartLinesChange();
  const shop = useShop();

  const [debugMsg, setDebugMsg] = useState("Extension loaded...");
  const isApplying = useRef(false);
  const lastSignature = useRef("");

  function buildSignature(lines) {
    return lines
      .filter(
        (line) =>
          !line.merchandise?.title?.toLowerCase().includes("handling fee") &&
          !line.attributes?.some((a) => a.key === "_handling_fee")
      )
      .map((line) => `${line.merchandise?.id}:${line.quantity}`)
      .sort()
      .join(",");
  }

  async function removeExistingFeeLines(lines) {
    const feeLines = lines.filter(
      (line) =>
        line.merchandise?.title?.toLowerCase().includes("handling fee") ||
        line.attributes?.some((a) => a.key === "_handling_fee")
    );
    for (const line of feeLines) {
      try {
        await applyCartLinesChange({
          type: "removeCartLine",
          id: line.id,
          quantity: line.quantity,
        });
      } catch (err) {
        console.error("[HandlingFee] remove error:", err);
      }
    }
  }

  useEffect(() => {
    async function applyFees() {
      if (isApplying.current) return;

      const signature = buildSignature(cartLines);
      if (signature === lastSignature.current) return;
      lastSignature.current = signature;

      const nonFeeLines = cartLines.filter(
        (line) =>
          !line.merchandise?.title?.toLowerCase().includes("handling fee") &&
          !line.attributes?.some((a) => a.key === "_handling_fee")
      );

      if (nonFeeLines.length === 0) {
        await removeExistingFeeLines(cartLines);
        setDebugMsg("Cart empty — no fees to apply.");
        return;
      }

      isApplying.current = true;

      try {
        const shopDomain = shop?.myshopifyDomain || "";

        if (!shopDomain) {
          setDebugMsg("ERROR: Could not read shop domain.");
          return;
        }

        const cartItems = nonFeeLines.map((line) => ({
          productId: line.merchandise?.product?.id,
          variantId: line.merchandise?.id,
          quantity: line.quantity,
          price: parseFloat(
            line.cost?.amountPerQuantity?.amount ||
              line.merchandise?.price?.amount ||
              "0"
          ),
          collectionIds: [],
        }));

        setDebugMsg(
          `Calling API... shop=${shopDomain}, items=${cartItems
            .map((i) => i.productId)
            .join(", ")}`
        );

        const response = await fetch(`${APP_URL}/api/fees`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Shop-Domain": shopDomain,
          },
          body: JSON.stringify({ shopDomain, cartItems }),
        });

        if (!response.ok) {
          setDebugMsg(`ERROR: API HTTP ${response.status}`);
          return;
        }

        const data = await response.json();

        if (data.error) {
          setDebugMsg(`API error: ${data.error}`);
          return;
        }

        if (!data.variantGid) {
          setDebugMsg(
            "No variantGid — go to app Settings → Create Handling Fee Product."
          );
          return;
        }

        if (!data.fees || data.fees.length === 0) {
          setDebugMsg(
            `No fees matched. API response: ${JSON.stringify(data)}`
          );
          await removeExistingFeeLines(cartLines);
          return;
        }

        await removeExistingFeeLines(cartLines);

        for (const fee of data.fees) {
          await applyCartLinesChange({
            type: "addCartLine",
            merchandiseId: data.variantGid,
            quantity: 1,
            attributes: [
              { key: "_handling_fee", value: "true" },
              { key: "_fee_label", value: fee.label },
              { key: "_fee_amount", value: String(fee.amount) },
            ],
          });
        }

        setDebugMsg(
          `✓ Applied: ${data.fees
            .map((f) => `${f.label} $${f.amount}`)
            .join(", ")}`
        );
      } catch (err) {
        setDebugMsg(`EXCEPTION: ${err.message}`);
        console.error("[HandlingFee]", err);
      } finally {
        isApplying.current = false;
      }
    }

    applyFees();
  }, [cartLines]);

  if (!DEBUG) return null;

  return (
    <BlockStack>
      <Banner status="info">
        <Text>[Handling Fee Debug] {debugMsg}</Text>
      </Banner>
    </BlockStack>
  );
}
