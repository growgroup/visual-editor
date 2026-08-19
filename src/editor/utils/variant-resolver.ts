/**
 * Variant Resolver Utilities
 *
 * Utilities for resolving and managing component variants.
 * Supports Figma-like variant properties with multi-dimensional combinations.
 */

import type {
  MasterComponent,
  VariantProperty,
  VariantDefinition,
} from '../../types/editor-components';

/**
 * Find a variant by its property values.
 * Matches variants where all specified property values match.
 *
 * @param master - The master component containing variants
 * @param propertyValues - Object mapping property names to values
 * @returns The matching variant definition or null if not found
 *
 * @example
 * const variant = findVariant(master, { size: 'large', state: 'hover' });
 */
export function findVariant(
  master: MasterComponent,
  propertyValues: Record<string, string>
): VariantDefinition | null {
  if (!master.variants || master.variants.length === 0) {
    return null;
  }

  const targetKey = createVariantKey(propertyValues);

  for (const variant of master.variants) {
    if (variant.propertyValues) {
      const variantKey = createVariantKey(variant.propertyValues);
      if (variantKey === targetKey) {
        return variant;
      }
    }
  }

  return null;
}

/**
 * Find a variant by its unique ID.
 *
 * @param master - The master component containing variants
 * @param variantId - The unique variant ID to find
 * @returns The variant definition or null if not found
 */
export function getVariantById(
  master: MasterComponent,
  variantId: string
): VariantDefinition | null {
  if (!master.variants) {
    return null;
  }

  return master.variants.find((v) => v.id === variantId) ?? null;
}

/**
 * Get the default variant for a master component.
 * Falls back to first variant if no explicit default is set.
 *
 * @param master - The master component
 * @returns The default variant definition or null if no variants exist
 */
export function getDefaultVariant(
  master: MasterComponent
): VariantDefinition | null {
  if (!master.variants || master.variants.length === 0) {
    return null;
  }

  // First, try to find by defaultVariantId
  if (master.defaultVariantId) {
    const defaultById = master.variants.find(
      (v) => v.id === master.defaultVariantId
    );
    if (defaultById) {
      return defaultById;
    }
  }

  // Second, try to find by isDefault flag
  const defaultByFlag = master.variants.find((v) => v.isDefault);
  if (defaultByFlag) {
    return defaultByFlag;
  }

  // Third, try to find by matching default property values
  if (master.variantProperties && master.variantProperties.length > 0) {
    const defaultPropertyValues: Record<string, string> = {};
    for (const prop of master.variantProperties) {
      defaultPropertyValues[prop.name] = prop.defaultValue;
    }
    const defaultByProps = findVariant(master, defaultPropertyValues);
    if (defaultByProps) {
      return defaultByProps;
    }
  }

  // Fallback to first variant
  return master.variants[0];
}

/**
 * Generate all possible variant combinations from variant properties.
 * Creates a Cartesian product of all property values.
 *
 * @param variantProperties - Array of variant property definitions
 * @returns Array of property value combinations
 *
 * @example
 * const properties = [
 *   { name: 'size', values: ['sm', 'md', 'lg'] },
 *   { name: 'state', values: ['default', 'hover'] }
 * ];
 * const combinations = generateVariantCombinations(properties);
 * // Returns:
 * // [
 * //   { size: 'sm', state: 'default' },
 * //   { size: 'sm', state: 'hover' },
 * //   { size: 'md', state: 'default' },
 * //   { size: 'md', state: 'hover' },
 * //   { size: 'lg', state: 'default' },
 * //   { size: 'lg', state: 'hover' }
 * // ]
 */
export function generateVariantCombinations(
  variantProperties: VariantProperty[]
): Record<string, string>[] {
  if (!variantProperties || variantProperties.length === 0) {
    return [{}];
  }

  // Start with an empty combination
  let combinations: Record<string, string>[] = [{}];

  // For each property, expand all existing combinations
  for (const property of variantProperties) {
    const newCombinations: Record<string, string>[] = [];

    for (const combination of combinations) {
      for (const value of property.values) {
        newCombinations.push({
          ...combination,
          [property.name]: value,
        });
      }
    }

    combinations = newCombinations;
  }

  return combinations;
}

/**
 * Create a variant key from property values for indexing/lookup.
 * Keys are deterministic (sorted alphabetically by property name).
 *
 * @param propertyValues - Object mapping property names to values
 * @returns A string key representing the property values
 *
 * @example
 * createVariantKey({ size: 'lg', state: 'hover' }); // 'size:lg|state:hover'
 */
export function createVariantKey(
  propertyValues: Record<string, string>
): string {
  if (!propertyValues || Object.keys(propertyValues).length === 0) {
    return '';
  }

  return Object.entries(propertyValues)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

/**
 * Parse a variant key back to property values.
 *
 * @param key - The variant key string to parse
 * @returns Object mapping property names to values
 *
 * @example
 * parseVariantKey('size:lg|state:hover'); // { size: 'lg', state: 'hover' }
 */
export function parseVariantKey(key: string): Record<string, string> {
  if (!key) {
    return {};
  }

  return Object.fromEntries(
    key.split('|').map((pair) => {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) {
        return [pair, ''];
      }
      return [pair.slice(0, colonIndex), pair.slice(colonIndex + 1)];
    })
  );
}

/**
 * Check if a variant exists for the given property values.
 *
 * @param master - The master component containing variants
 * @param propertyValues - Object mapping property names to values
 * @returns True if a variant with these property values exists
 */
export function variantExists(
  master: MasterComponent,
  propertyValues: Record<string, string>
): boolean {
  return findVariant(master, propertyValues) !== null;
}

/**
 * Create a Map of variants indexed by their variant key.
 * Useful for fast lookups when rendering variant matrices.
 *
 * @param variants - Array of variant definitions
 * @returns Map from variant key to variant definition
 */
export function createVariantMap(
  variants: VariantDefinition[]
): Map<string, VariantDefinition> {
  const map = new Map<string, VariantDefinition>();

  for (const variant of variants) {
    if (variant.propertyValues) {
      const key = createVariantKey(variant.propertyValues);
      map.set(key, variant);
    }
  }

  return map;
}

/**
 * Get the count of missing variants (combinations without definitions).
 *
 * @param variantProperties - Array of variant property definitions
 * @param variants - Array of existing variant definitions
 * @returns Number of missing variant combinations
 */
export function getMissingVariantCount(
  variantProperties: VariantProperty[],
  variants: VariantDefinition[]
): number {
  const allCombinations = generateVariantCombinations(variantProperties);
  const variantMap = createVariantMap(variants);

  let missingCount = 0;
  for (const combination of allCombinations) {
    const key = createVariantKey(combination);
    if (!variantMap.has(key)) {
      missingCount++;
    }
  }

  return missingCount;
}

/**
 * Validate that a variant's property values match the component's variant properties.
 *
 * @param variantProperties - Array of variant property definitions
 * @param propertyValues - Property values to validate
 * @returns Object with isValid boolean and optional error message
 */
export function validateVariantPropertyValues(
  variantProperties: VariantProperty[],
  propertyValues: Record<string, string>
): { isValid: boolean; error?: string } {
  // Check all required properties are present
  for (const prop of variantProperties) {
    if (!(prop.name in propertyValues)) {
      return {
        isValid: false,
        error: `Missing required property: ${prop.name}`,
      };
    }

    const value = propertyValues[prop.name];
    if (!prop.values.includes(value)) {
      return {
        isValid: false,
        error: `Invalid value '${value}' for property '${prop.name}'. Valid values: ${prop.values.join(', ')}`,
      };
    }
  }

  // Check for extra properties
  const validPropertyNames = new Set(variantProperties.map((p) => p.name));
  for (const propName of Object.keys(propertyValues)) {
    if (!validPropertyNames.has(propName)) {
      return {
        isValid: false,
        error: `Unknown property: ${propName}`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Generate a human-readable name for a variant based on its property values.
 *
 * @param propertyValues - Object mapping property names to values
 * @returns A formatted variant name
 *
 * @example
 * generateVariantName({ size: 'lg', state: 'hover' }); // 'Size=lg, State=hover'
 */
export function generateVariantName(
  propertyValues: Record<string, string>
): string {
  if (!propertyValues || Object.keys(propertyValues).length === 0) {
    return 'Default';
  }

  return Object.entries(propertyValues)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${capitalize(key)}=${value}`)
    .join(', ');
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Find the closest matching variant when exact match is not found.
 * Useful for graceful degradation when a specific variant combination doesn't exist.
 *
 * @param master - The master component containing variants
 * @param targetPropertyValues - The desired property values
 * @returns The closest matching variant or default variant
 */
export function findClosestVariant(
  master: MasterComponent,
  targetPropertyValues: Record<string, string>
): VariantDefinition | null {
  // First, try exact match
  const exactMatch = findVariant(master, targetPropertyValues);
  if (exactMatch) {
    return exactMatch;
  }

  if (!master.variants || master.variants.length === 0) {
    return null;
  }

  // Score each variant by how many properties match
  let bestMatch: VariantDefinition | null = null;
  let bestScore = -1;

  for (const variant of master.variants) {
    if (!variant.propertyValues) continue;

    let score = 0;
    for (const [key, value] of Object.entries(targetPropertyValues)) {
      if (variant.propertyValues[key] === value) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = variant;
    }
  }

  // If no matches at all, return default
  if (bestScore === 0) {
    return getDefaultVariant(master);
  }

  return bestMatch;
}

/**
 * Get all unique values for a specific property across all variants.
 *
 * @param variants - Array of variant definitions
 * @param propertyName - The property name to extract values for
 * @returns Array of unique values
 */
export function getPropertyValuesFromVariants(
  variants: VariantDefinition[],
  propertyName: string
): string[] {
  const values = new Set<string>();

  for (const variant of variants) {
    if (variant.propertyValues && variant.propertyValues[propertyName]) {
      values.add(variant.propertyValues[propertyName]);
    }
  }

  return Array.from(values);
}

/**
 * Infer variant properties from existing variants.
 * Useful when variants exist but properties aren't explicitly defined.
 *
 * @param variants - Array of variant definitions
 * @returns Array of inferred variant properties
 */
export function inferVariantProperties(
  variants: VariantDefinition[]
): VariantProperty[] {
  const propertyMap = new Map<string, Set<string>>();

  // Collect all property names and their values
  for (const variant of variants) {
    if (variant.propertyValues) {
      for (const [key, value] of Object.entries(variant.propertyValues)) {
        if (!propertyMap.has(key)) {
          propertyMap.set(key, new Set());
        }
        propertyMap.get(key)!.add(value);
      }
    }
  }

  // Convert to VariantProperty array
  const properties: VariantProperty[] = [];
  let index = 0;

  for (const [name, valuesSet] of propertyMap) {
    const values = Array.from(valuesSet).sort();
    properties.push({
      id: `prop-${index++}`,
      name,
      values,
      defaultValue: values[0] ?? 'default',
    });
  }

  return properties.sort((a, b) => a.name.localeCompare(b.name));
}
