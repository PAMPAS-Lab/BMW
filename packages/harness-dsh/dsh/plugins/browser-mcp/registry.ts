export interface Definition { name: string; [key: string]: unknown }
export interface Registry { register(definition: Definition): () => void }

export function browserRegistry(registry: Registry, prepare?: (args: unknown, execution: unknown) => Promise<unknown>): Registry {
  return new Proxy(registry, {
    get(target, key) {
      if (key === 'register') return (definition: Definition) => {
        if (definition.name !== 'mcp__browser__browser') throw new Error('BMW MCP may expose only the browser tool.')
        const execute = definition.execute
        return target.register({ ...definition, name: 'browser', ...(prepare && typeof execute === 'function' ? {
          execute: async (args: unknown, execution: unknown) => execute(await prepare(args, execution), execution)
        } : {}) })
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
