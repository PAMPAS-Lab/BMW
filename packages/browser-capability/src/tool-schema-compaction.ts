import type {JsonSchema} from './browser-schema.js'

const single=new Set(['additionalProperties','additionalItems','unevaluatedProperties','unevaluatedItems','contains','propertyNames','not','if','then','else','contentSchema'])
const arrays=new Set(['allOf','anyOf','oneOf','prefixItems'])
const maps=new Set(['properties','patternProperties','dependentSchemas','dependencies'])
const keywords=new Set(['$schema','$id','$comment','type','enum','const','title','description','default','examples','readOnly','writeOnly','deprecated','format','contentEncoding','contentMediaType','required','dependentRequired','minProperties','maxProperties','minItems','maxItems','uniqueItems','minContains','maxContains','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern','items',...single,...arrays,...maps])
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const identifier=(value:JsonSchema)=>typeof value.$id==='string'

/** Visit schema positions only: const/default/examples and property names are data. */
function mapChildren(schema:JsonSchema,visit:(schema:JsonSchema)=>JsonSchema):Record<string,unknown>{
 return Object.fromEntries(Object.entries(schema).map(([key,value])=>{
  if(single.has(key)||key==='items'&&!Array.isArray(value))return [key,object(value)?visit(value):structuredClone(value)]
  if((arrays.has(key)||key==='items')&&Array.isArray(value))return [key,value.map(item=>object(item)?visit(item):structuredClone(item))]
  if(maps.has(key)&&object(value))return [key,Object.fromEntries(Object.entries(value).map(([name,item])=>[name,object(item)?visit(item):structuredClone(item)]))]
  return [key,structuredClone(value)]
 }))
}

/** Lossless wire factoring; native action/help schemas remain the authority.
 * Each embedded $id resource gets its own definitions. Existing references,
 * anchors, definitions or unknown vocabulary leave that resource untouched. */
export function compactToolSchema<T extends JsonSchema>(input:T):T {
 let totalNodes=0
 const compact=(root:JsonSchema):JsonSchema=>{
  // MCP's default is 2020-12. Other dialects and fragment identifiers are
  // deliberately opaque rather than guessing their identifier/ref rules.
  if(root.$schema!==undefined&&root.$schema!=='https://json-schema.org/draft/2020-12/schema'||typeof root.$id==='string'&&(!root.$id||root.$id.includes('#')))return structuredClone(root)
  const counts=new Map<string,number>(),keys=new WeakMap<object,string>(),eligible=new WeakSet<object>(),ancestors=new Set<object>()
  let unsafe=false
  const inspect=(schema:JsonSchema,isRoot=false):boolean=>{
   if(++totalNodes>30000)throw new TypeError('Browser schema exceeds compaction node budget.')
   if(ancestors.has(schema))throw new TypeError('Browser schema must be acyclic.')
   if(!isRoot&&identifier(schema))return true
   if(Object.keys(schema).some(key=>!keywords.has(key))||!isRoot&&schema.$schema!==undefined)unsafe=true
   ancestors.add(schema);let embedded=false
   mapChildren(schema,child=>{embedded=inspect(child)||embedded;return child});ancestors.delete(schema)
   if(!isRoot&&!embedded){const key=JSON.stringify(schema);if(key.length>=256){keys.set(schema,key);eligible.add(schema);counts.set(key,(counts.get(key)??0)+1)}}
   return embedded
  }
  inspect(root,true)
  if(unsafe)return structuredClone(root)
  const definitionKey='$defs'
  const definitions:Record<string,JsonSchema>={},names=new Map<string,string>()
  const build=(schema:JsonSchema,isRoot=false):JsonSchema=>{
   if(!isRoot&&identifier(schema))return compact(schema)
   const key=eligible.has(schema)?keys.get(schema):undefined
   if(key&&(counts.get(key)??0)>1){
    let name=names.get(key)
    if(!name){name='bmwShared'+names.size;names.set(key,name);definitions[name]=mapChildren(schema,child=>build(child))}
    return {$ref:'#/'+definitionKey+'/'+name}
   }
   return mapChildren(schema,child=>build(child))
  }
  const result=build(root,true)
  if(names.size>1024)throw new TypeError('Browser schema exceeds shared definition budget.')
  const output=names.size?{...result,[definitionKey]:definitions}:result
  return JSON.stringify(output).length<JSON.stringify(root).length?output:structuredClone(root)
 }
 return compact(input) as T
}
