declare module "pyodide/pyodide.asm.mjs" {
  const createPyodideModule: (settings: object) => Promise<never>;
  export default createPyodideModule;
}
