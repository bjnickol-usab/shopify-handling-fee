import { extension } from "@shopify/ui-extensions/checkout";

// Your Vercel app URL - already set to your production URL
const APP_URL = "https://shopify-handling-fee.vercel.app";

export default extension(
  "purchase.checkout.cart-line-list.render-after",
  async (root, api) => {
    const { lines, applyCartLinesChange, shop } = api;

    let isApplying = false;
    let lastSignature = "";

    function buildSignature(currentLines) {
      return currentLines
        .filter(
          (line) =>
            !line.merchandise?.title?.toLowerCase().includes("handling fee") &&
            !line.attributes?.some((a) => a.key === "_handling_fee")
        )
        .map((line) => `${line.merchandise?.id}:${line.quantity}`)
        .sort()
        .join(",");
    }

    async function removeExistingFeeLines(currentLines) {
      const feeLines = currentLines.filter(
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
          console.error("Error removing fee line:", err);
        }
      }
    }

    async function applyFees(currentLines) {
      if (isApplying) return;

      const signature = buildSignature(currentLines);
      if (signature === lastSignature) return;
      lastSignature = signature;

      const nonFeeLines = currentLines.filter(
        (line) =>
          !line.merchandise?.title?.toLowerCase().includes("handling fee") &&
          !line.attributes?.some((a) => a.key === "_handling_fee")
      );

      if (nonFeeLines.length === 0) {
        await removeExistingFeeLines(currentLines);
        return;
      }

      isApplying = true;

      try {
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

        const shopDomain =
          shop?.myshopifyDomain ||
          shop?.domain ||
          "";

        const response = await fetch(`${APP_URL}/api/fees`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Shop-Domain": shopDomain,
          },
          body: JSON.stringify({
            shopDomain,
            cartItems,
          }),
        });

        if (!response.ok) {
          console.error("Fee API error:", response.status);
          isApplying = false;
          return;
        }

        const data = await response.json();

        // Remove existing fee lines before adding new ones
        await removeExistingFeeLines(currentLines);

        if (!data.fees || data.fees.length === 0 || !data.variantGid) {
          isApplying = false;
          return;
        }

        // Add new fee line(s)
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
      } catch (err) {
        console.error("Handling fee extension error:", err);
      } finally {
        isApplying = false;
      }
    }

    // Run on initial load
    await applyFees(lines.current);

    // Subscribe to cart line changes
    lines.subscribe(async (currentLines) => {
      await applyFees(currentLines);
    });
  }
);
