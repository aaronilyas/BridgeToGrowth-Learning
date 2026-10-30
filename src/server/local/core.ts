export type LocalUser = {
  id: string;
  email: string;
  settings: Record<string, unknown>;
};

export const LOCAL_EMAIL = "local@localhost";
