import type { JSX } from "react";
import { AuthForm } from "../components/AuthForm.tsx";

// O(1)
export function LoginPage(): JSX.Element {
  return <AuthForm mode="login" />;
}
