import { deleteStripeCustomer } from "../billing/stripe.ts";

// O(1) network call
export async function deleteAccountCustomer(customer: string): Promise<void> {
  await deleteStripeCustomer(customer);
}
