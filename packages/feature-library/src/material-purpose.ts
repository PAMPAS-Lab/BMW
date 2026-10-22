export const MATERIAL_PURPOSES=['unclassified','source','derived','preview','work','support'] as const
export type MaterialPurpose=typeof MATERIAL_PURPOSES[number]
export function purpose(raw:unknown):MaterialPurpose{if(!MATERIAL_PURPOSES.includes(raw as MaterialPurpose))throw new TypeError('Invalid material purpose.');return raw as MaterialPurpose}
