export interface Definition { name: string; [key: string]: unknown }
export interface Registry { register(definition: Definition): () => void }

export function browserRegistry(registry: Registry, prepare?: (args: unknown, execution: unknown) => Promise<unknown>, observe?: (execution: unknown, error?: unknown) => void): Registry {
  return new Proxy(registry, {
    get(target, key) {
      if (key === 'register') return (definition: Definition) => {
        if (definition.name !== 'mcp__browser__browser') throw new Error('BMW MCP may expose only the browser tool.')
        const execute = definition.execute
        return target.register({ ...definition, name: 'browser', ...((prepare || observe) && typeof execute === 'function' ? {
          execute: async (args: unknown, execution: unknown) => {
            try {
              const value = await execute(prepare ? await prepare(args, execution) : args, execution)
              observe?.(execution)
              return value
            } catch (error) { observe?.(execution, error); throw error }
          }
        } : {}) })
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
