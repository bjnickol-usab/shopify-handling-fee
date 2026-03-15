import { Outlet } from "@remix-run/react";
import { authenticate } from "../shopify.server.js";

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    return null;
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("App layout auth error:", err);
    throw err;
  }
}

export default function App() {
  return <Outlet />;
}
