// @ts-check
// shopify.extend is a global injected by the Shopify CLI runtime

const APP_URL = "https://shopify-handling-fee.vercel.app";

// Set to true to show a debug banner at checkout - useful for troubleshooting
const DEBUG = true;

shopify.extend(
  "purchase.checkout.cart-line-list.render-after",
  async (root, api) => {
    const { lines, applyCartLinesChange, shop } = api;

    let isApplying = false;
    let lastSignature = "";

    // ── Debug banner ──────────────────────────────────────────────────────
    let debugEl = null;
    function showDebug(msg) {
      if (!DEBUG) return;
      console.log("[HandlingFee]", msg);
      if (!debugEl) {
        debugEl = root.createComponent("BlockStack", { spacing: "none" });
        const banner = root.createComponent("Banner", { status: "info" });
        debugEl.appendChild(banner);
        root.appendChild(debugEl);
      }
      // Update text - clear and re-add
      while (debugEl.firstChild) debugEl.removeChild(debugEl.firstChild);
      const banner = root.createComponent("Banner", { status: "info" });
      const text = root.createComponent("Text");
      text.appendChild(root.createText("[Handling Fee Debug] " + msg));
      banner.appendChild(text);
      debugEl.appendChild(banner);
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
          console.error("[HandlingFee] Error removing fee line:", err);
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
        showDebug("Cart is empty or only contains fee lines — removed fees.");
        return;
      }

      isApplying = true;
      showDebug(`Checking ${nonFeeLines.length} cart item(s)...`);

      try {
        const shopDomain =
          shop?.myshopifyDomain ||
          shop?.domain ||
          "";

        if (!shopDomain) {
          showDebug("ERROR: Could not determine shop domain from checkout API.");
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

        showDebug(
          `Shop: ${shopDomain} | Items: ${cartItems.map((i) => i.productId).join(", ")}`
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
          showDebug(`ERROR: API returned HTTP ${response.status}`);
          isApplying = false;
          return;
        }

        const data = await response.json();
        showDebug(
          `API response: fees=${JSON.stringify(data.fees)}, variantGid=${data.variantGid}`
        );

        if (data.error) {
          showDebug(`API error: ${data.error}`);
          isApplying = false;
          return;
        }

        await removeExistingFeeLines(currentLines);

        if (!data.variantGid) {
          showDebug(
            "No variantGid — go to app Settings and click Create Handling Fee Product."
          );
          isApplying = false;
          return;
        }

        if (!data.fees || data.fees.length === 0) {
          showDebug("No fees matched for items in this cart.");
          isApplying = false;
          return;
        }

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

        showDebug(`✓ Applied ${data.fees.length} fee(s): ${data.fees.map((f) => f.label + " $" + f.amount).join(", ")}`);
      } catch (err) {
        showDebug(`EXCEPTION: ${err.message}`);
        console.error("[HandlingFee] Error:", err);
      } finally {
        isApplying = false;
      }
    }

    // ── Run ───────────────────────────────────────────────────────────────
    showDebug("Extension loaded — checking cart...");
    await applyFees(lines.current);

    lines.subscribe(async (currentLines) => {
      await applyFees(currentLines);
    });
  }
);
