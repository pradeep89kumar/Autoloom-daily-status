import { RouterProvider } from "react-router";
import { Analytics } from "@vercel/analytics/react";
import { router } from "./routes";

function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Analytics />
    </>
  );
}

export default App;
