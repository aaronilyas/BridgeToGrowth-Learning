import { ApiError } from './http';
import { Job } from './job-policy';
import { Session } from './session';
export async function cancelAndReconcile(session: Session, id: string): Promise<Job> {
  let failure: unknown;
  try { await session.request<Job>(`/lessons/${id}/cancel`, {}); }
  catch (error) { failure = error; }
  // Acknowledgement is intent, not outcome. Also reconcile conflicts and lost responses.
  const current = await session.request<Job>(`/lessons/${id}`);
  if (failure && !(failure instanceof ApiError && failure.status === 409)) throw failure;
  return current;
}
