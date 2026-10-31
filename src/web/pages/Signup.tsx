import type { JSX } from "react";
import { AuthForm } from "../components/AuthForm.tsx";

// O(1)
export function SignupPage(): JSX.Element {
  return <AuthForm mode="signup" />;
}
