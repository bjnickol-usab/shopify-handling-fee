import { extension, Banner, Text, BlockStack } from "@shopify/ui-extensions/checkout";

const APP_URL = "https://shopify-handling-fee.vercel.app";
const DEBUG = false;

export default extension(
  "purchase.checkout.cart-line-list.render-after",
  async (root, api) => {
    const { lines, applyCartLinesChange, shop } = api;

    let isApplying = false;
    let lastSignature = "";

    // ── Debug banner ──────────────────────────────────────────────────────
    const stack = root.createComponent(BlockStack);
    const banner = root.createComponent(Banner, { status: "info" });
    const debugText = root.createComponent(Text);
    debugText.appendChild(root.createText("Extension loaded..."));
    banner.appendChild(debugText);
    stack.appendChild(banner);
    if (DEBUG) root.appendChild(stack);
    root.mount();

    function setDebug(msg) {
      if (!DEBUG) return;
      console.log("[HandlingFee]", msg);
      while (debugText.firstChild) debugText.removeChild(debugText.firstChild);
      debugText.appendChild(root.createText("[Handling Fee Debug] " + msg));
    }

    // ── Helpers ───────────────────────────────────────────────────────────
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
          console.error("[HandlingFee] remove error:", err);
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
        setDebug("Cart empty — no fees to apply.");
        return;
      }

      isApplying = true;

      try {
        const shopDomain = shop?.myshopifyDomain || shop?.domain || "";

        if (!shopDomain) {
          setDebug("ERROR: Could not read shop domain from checkout API.");
          isApplying = false;
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

        setDebug(
          `Calling API... shop=${shopDomain} items=${cartItems
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
          setDebug(`ERROR: API returned HTTP ${response.status}`);
          isApplying = false;
          return;
        }

        const data = await response.json();

        if (data.error) {
          setDebug(`API error: ${data.error}`);
          isApplying = false;
          return;
        }

        if (!data.variantGid) {
          setDebug(
            "No variantGid — go to app Settings and click Create Handling Fee Product."
          );
          isApplying = false;
          return;
        }

        if (!data.fees || data.fees.length === 0) {
          setDebug(`No fees matched. Raw response: ${JSON.stringify(data)}`);
          await removeExistingFeeLines(currentLines);
          isApplying = false;
          return;
        }

        await removeExistingFeeLines(currentLines);

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

        setDebug(
          `✓ Applied: ${data.fees
            .map((f) => `${f.label} $${f.amount}`)
            .join(", ")}`
        );
      } catch (err) {
        setDebug(`EXCEPTION: ${err.message}`);
        console.error("[HandlingFee]", err);
      } finally {
        isApplying = false;
      }
    }

    // ── Initial run + subscribe ───────────────────────────────────────────
    setDebug("Checking cart...");
    await applyFees(lines.current);

    lines.subscribe(async (currentLines) => {
      await applyFees(currentLines);
    });
  }
);
