/**
 * figma-kiwi-decoder.ts
 *
 * Custom Figma kiwi decoder that handles newer schema versions.
 * Implements full kiwi binary format parsing with extended primitive types.
 */

import * as pako from 'pako';
import { cacheSchema } from './figma-kiwi-encoder';

// Extended types array
const EXTENDED_TYPES = [
  'bool',     // -1 -> 0
  'byte',     // -2 -> 1
  'int',      // -3 -> 2
  'uint',     // -4 -> 3
  'float',    // -5 -> 4
  'string',   // -6 -> 5
  'int64',    // -7 -> 6
  'uint64',   // -8 -> 7
  'double',   // -9 -> 8
  'bytes',    // -10 -> 9
  'type10',   // -11 -> 10
  'type11',   // -12 -> 11
  'type12',   // -13 -> 12
  'type13',   // -14 -> 13
  'type14',   // -15 -> 14
  'type15',   // -16 -> 15
];

const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'];

interface Field {
  name: string;
  line: number;
  column: number;
  type: string | number | null;
  isArray: boolean;
  isDeprecated: boolean;
  value: number;
}

interface Definition {
  name: string;
  line: number;
  column: number;
  kind: string;
  fields: Field[];
}

interface Schema {
  package: null;
  definitions: Definition[];
}

/**
 * ByteBuffer for reading binary data (matching kiwi-schema's implementation)
 */
class ByteBuffer {
  private data: Uint8Array;
  private index: number = 0;

  constructor(data: Uint8Array | ArrayBuffer) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  readByte(): number {
    if (this.index >= this.data.length) {
      throw new Error('Read past end of buffer');
    }
    return this.data[this.index++];
  }

  readVarUint(): number {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.readByte();
      value |= (byte & 0x7F) << shift;
      shift += 7;
    } while (byte & 0x80);
    return value >>> 0;
  }

  readVarInt(): number {
    const value = this.readVarUint();
    return (value & 1) ? ~(value >>> 1) : (value >>> 1);
  }

  /**
   * Read null-terminated UTF-8 string (kiwi format)
   */
  readString(): string {
    let result = '';
    while (true) {
      let codePoint: number;
      // Decode UTF-8
      const a = this.readByte();
      if (a < 0xC0) {
        codePoint = a;
      } else {
        const b = this.readByte();
        if (a < 0xE0) {
          codePoint = ((a & 0x1F) << 6) | (b & 0x3F);
        } else {
          const c = this.readByte();
          if (a < 0xF0) {
            codePoint = ((a & 0x0F) << 12) | ((b & 0x3F) << 6) | (c & 0x3F);
          } else {
            const d = this.readByte();
            codePoint = ((a & 0x07) << 18) | ((b & 0x3F) << 12) | ((c & 0x3F) << 6) | (d & 0x3F);
          }
        }
      }
      // Strings are null-terminated
      if (codePoint === 0) {
        break;
      }
      // Encode UTF-16
      if (codePoint < 0x10000) {
        result += String.fromCharCode(codePoint);
      } else {
        codePoint -= 0x10000;
        result += String.fromCharCode((codePoint >> 10) + 0xD800, (codePoint & ((1 << 10) - 1)) + 0xDC00);
      }
    }
    return result;
  }

  get position(): number {
    return this.index;
  }

  get remaining(): number {
    return this.data.length - this.index;
  }

  /**
   * Read length-prefixed byte array
   */
  readByteArray(): Uint8Array {
    const length = this.readVarUint();
    const start = this.index;
    const end = start + length;
    if (end > this.data.length) {
      throw new Error('Read array out of bounds');
    }
    this.index = end;
    const result = new Uint8Array(length);
    result.set(this.data.subarray(start, end));
    return result;
  }

  /**
   * Read variable-length float (kiwi optimization format)
   */
  readVarFloat(): number {
    const index = this.index;
    const data = this.data;
    const length = data.length;

    // Optimization: use a single byte to store zero
    if (index + 1 > length) {
      throw new Error('Index out of bounds');
    }
    const first = data[index];
    if (first === 0) {
      this.index = index + 1;
      return 0;
    }

    // Endian-independent 32-bit read
    if (index + 4 > length) {
      throw new Error('Index out of bounds');
    }
    let bits = first | (data[index + 1] << 8) | (data[index + 2] << 16) | (data[index + 3] << 24);
    this.index = index + 4;

    // Move the exponent back into place
    bits = (bits << 23) | (bits >>> 9);

    // Reinterpret as a floating-point number
    const int32 = new Int32Array(1);
    const float32 = new Float32Array(int32.buffer);
    int32[0] = bits;
    return float32[0];
  }
}

/**
 * Custom implementation of decodeBinarySchema with extended type support
 */
function customDecodeBinarySchema(buffer: Uint8Array, types: string[]): Schema {
  const bb = new ByteBuffer(buffer);
  const definitionCount = bb.readVarUint();
  const definitions: Definition[] = [];

  console.log('[figma-kiwi-decoder] Custom decode: definition count =', definitionCount);

  // Read in the schema
  for (let i = 0; i < definitionCount; i++) {
    const definitionName = bb.readString();
    const kind = bb.readByte();
    const fieldCount = bb.readVarUint();
    const fields: Field[] = [];

    for (let j = 0; j < fieldCount; j++) {
      const fieldName = bb.readString();
      const type = bb.readVarInt();
      const isArray = !!(bb.readByte() & 1);
      const value = bb.readVarUint();

      fields.push({
        name: fieldName,
        line: 0,
        column: 0,
        type: KINDS[kind] === 'ENUM' ? null : type,
        isArray,
        isDeprecated: false,
        value,
      });
    }

    definitions.push({
      name: definitionName,
      line: 0,
      column: 0,
      kind: KINDS[kind] || 'MESSAGE',
      fields,
    });
  }

  // Bind type names afterwards
  for (let i = 0; i < definitionCount; i++) {
    const fields = definitions[i].fields;
    for (let j = 0; j < fields.length; j++) {
      const field = fields[j];
      const type = field.type;
      if (type !== null && typeof type === 'number') {
        if (type < 0) {
          const typeIndex = ~type;
          if (typeIndex >= types.length) {
            // Use a placeholder for unknown types
            field.type = `unknown_type_${typeIndex}`;
          } else {
            field.type = types[typeIndex];
          }
        } else {
          if (type >= definitions.length) {
            field.type = `ref_${type}`;
          } else {
            field.type = definitions[type].name;
          }
        }
      }
    }
  }

  return {
    package: null,
    definitions,
  };
}

/**
 * Parse Figma archive format (fig-kiwi header)
 */
function parseArchive(buffer: Uint8Array): { schema: Uint8Array; data: Uint8Array } {
  const prelude = 'fig-kiwi';
  const preludeBytes = new TextEncoder().encode(prelude);

  // Check prelude
  const actualPrelude = new TextDecoder().decode(buffer.slice(0, preludeBytes.length));
  if (actualPrelude !== prelude) {
    throw new Error(`Invalid fig-kiwi prelude: got "${actualPrelude}"`);
  }

  let offset = preludeBytes.length;

  // Read version (4 bytes, little endian)
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  const version = view.getUint32(offset, true);
  console.log('[figma-kiwi-decoder] Archive version:', version);
  offset += 4;

  const files: Uint8Array[] = [];

  // Read chunks
  while (offset + 4 <= buffer.length) {
    const size = view.getUint32(offset, true);
    offset += 4;

    if (offset + size > buffer.length) {
      files.push(buffer.slice(offset));
      break;
    }

    files.push(buffer.slice(offset, offset + size));
    offset += size;
  }

  if (files.length < 2) {
    throw new Error(`Invalid archive: expected at least 2 chunks, got ${files.length}`);
  }

  return {
    schema: files[0],
    data: files[1],
  };
}

/**
 * Parse Figma clipboard HTML and extract data using custom decoder
 */
export interface FigmaClipboardData {
  meta: {
    fileKey: string;
    pasteID: number;
    dataType: string;
  };
  message: Record<string, unknown>;
  schema: Schema;
}

export function parseFigmaClipboardToJson(html: string): FigmaClipboardData {
  // Extract metadata
  const metaMatch = html.match(/\(figmeta\)([A-Za-z0-9+/=]+)\(\/figmeta\)/);
  if (!metaMatch) {
    throw new Error('Figma metadata not found');
  }
  const meta = JSON.parse(atob(metaMatch[1]));
  console.log('[figma-kiwi-decoder] Meta:', meta);

  // Extract binary data
  const dataMatch = html.match(/\(figma\)([A-Za-z0-9+/=]+)\(\/figma\)/);
  if (!dataMatch) {
    throw new Error('Figma data not found');
  }

  // Decode base64 to Uint8Array
  const binaryString = atob(dataMatch[1]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  console.log('[figma-kiwi-decoder] Binary data size:', bytes.length);

  // Parse archive
  const archive = parseArchive(bytes);
  console.log('[figma-kiwi-decoder] Schema chunk size:', archive.schema.length);
  console.log('[figma-kiwi-decoder] Data chunk size:', archive.data.length);

  // Decompress schema and data
  const schemaDecompressed = pako.inflateRaw(archive.schema);
  const dataDecompressed = pako.inflateRaw(archive.data);
  console.log('[figma-kiwi-decoder] Schema decompressed size:', schemaDecompressed.length);
  console.log('[figma-kiwi-decoder] Data decompressed size:', dataDecompressed.length);

  // Decode schema with extended types
  const schema = customDecodeBinarySchema(schemaDecompressed, EXTENDED_TYPES);
  console.log('[figma-kiwi-decoder] Schema definitions:', schema.definitions.length);

  // Cache schema for later use in encoding (Figma export)
  cacheSchema(schema, archive.schema);

  // Export raw schema for bundling (one-time capture)
  if (typeof window !== 'undefined') {
    const schemaBase64 = btoa(String.fromCharCode(...archive.schema));
    console.log('[figma-kiwi-decoder] RAW SCHEMA BASE64 (copy this for bundling):');
    console.log(schemaBase64);
  }

  // Find Message definition
  const messageDefIndex = schema.definitions.findIndex(d => d.name === 'Message');
  if (messageDefIndex === -1) {
    throw new Error('Message definition not found in schema');
  }
  console.log('[figma-kiwi-decoder] Message definition found at index:', messageDefIndex);

  // Find and log NodeChange definition to see available fields
  const nodeChangeDef = schema.definitions.find(d => d.name === 'NodeChange');
  if (nodeChangeDef) {
    console.log('[figma-kiwi-decoder] NodeChange fields:',
      nodeChangeDef.fields.map(f => `${f.name}(${f.value})`).join(', '));
    // Look for parent-related fields
    const parentFields = nodeChangeDef.fields.filter(f =>
      f.name.toLowerCase().includes('parent') || f.name.toLowerCase().includes('index'));
    if (parentFields.length > 0) {
      console.log('[figma-kiwi-decoder] Parent-related fields:', parentFields.map(f => f.name));
    }
  }

  // Log Paint-related definitions to see what fields are available
  const paintDefs = schema.definitions.filter(d =>
    d.name.toLowerCase().includes('paint') || d.name.toLowerCase().includes('image'));
  for (const def of paintDefs) {
    console.log(`[figma-kiwi-decoder] ${def.name} (${def.kind}): ${def.fields.map(f => `${f.name}:${f.type}(${f.value})`).join(', ')}`);
  }

  // Log PaintType enum if it exists
  const paintTypeEnum = schema.definitions.find(d => d.name === 'PaintType');
  if (paintTypeEnum) {
    console.log('[figma-kiwi-decoder] PaintType enum values:', paintTypeEnum.fields.map(f => `${f.name}=${f.value}`).join(', '));
  }

  // Compile schema and decode message using our custom implementation
  const message = decodeMessage(dataDecompressed, schema);

  console.log('[figma-kiwi-decoder] Message decoded, type:', message.type);

  return { meta, message, schema };
}

/**
 * Decode a message using the compiled schema
 */
function decodeMessage(buffer: Uint8Array, schema: Schema): Record<string, unknown> {
  const bb = new ByteBuffer(buffer);

  // Build definition map
  const defMap = new Map<string, Definition>();
  for (const def of schema.definitions) {
    defMap.set(def.name, def);
  }

  // Find Message definition
  const messageDef = defMap.get('Message');
  if (!messageDef) {
    throw new Error('Message definition not found');
  }

  const result = decodeStruct(bb, messageDef, defMap);
  // Message should always be a struct, not an enum
  if (typeof result === 'string') {
    throw new Error('Message definition is unexpectedly an enum');
  }
  return result;
}

/**
 * Decode a value based on its type
 */
function decodeValue(
  bb: ByteBuffer,
  typeName: string | null,
  isArray: boolean,
  defMap: Map<string, Definition>
): unknown {
  if (isArray) {
    const length = bb.readVarUint();
    const arr: unknown[] = [];
    for (let i = 0; i < length; i++) {
      arr.push(decodeValue(bb, typeName, false, defMap));
    }
    return arr;
  }

  switch (typeName) {
    case 'bool':
      return bb.readByte() !== 0;
    case 'byte':
      return bb.readByte();
    case 'int':
    case 'int64':
      return bb.readVarInt();
    case 'uint':
    case 'uint64':
      return bb.readVarUint();
    case 'float':
      return bb.readVarFloat();
    case 'double':
      return readDouble(bb);
    case 'string':
      return bb.readString();
    case 'bytes':
      return bb.readByteArray();
    default:
      // Check if it's a reference to another definition
      if (typeName && defMap.has(typeName)) {
        const def = defMap.get(typeName)!;
        // Handle ENUM types - resolve to name
        if (def.kind === 'ENUM') {
          const enumValue = bb.readVarUint();
          // Find the enum field with this value
          for (const field of def.fields) {
            if (field.value === enumValue) {
              return field.name;
            }
          }
          // Return raw value if no matching field found
          return `UNKNOWN_ENUM_${enumValue}`;
        }
        return decodeStruct(bb, def, defMap);
      }
      // Unknown type - try to skip or return null
      console.warn(`[figma-kiwi-decoder] Unknown type: ${typeName}`);
      return null;
  }
}

/**
 * Read a double from the buffer (8 bytes, little endian)
 */
function readDouble(bb: ByteBuffer): number {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = bb.readByte();
  }
  return new DataView(bytes.buffer).getFloat64(0, true);
}

/**
 * Decode a struct or message
 */
function decodeStruct(
  bb: ByteBuffer,
  def: Definition,
  defMap: Map<string, Definition>
): Record<string, unknown> | string {
  const result: Record<string, unknown> = {};

  // ENUMs should be handled in decodeValue, but handle here as fallback
  if (def.kind === 'ENUM') {
    const enumValue = bb.readVarUint();
    for (const field of def.fields) {
      if (field.value === enumValue) {
        return field.name;
      }
    }
    return `UNKNOWN_ENUM_${enumValue}`;
  }

  if (def.kind === 'STRUCT') {
    for (const field of def.fields) {
      try {
        result[field.name] = decodeValue(bb, field.type as string, field.isArray, defMap);
      } catch (e) {
        console.warn(`[figma-kiwi-decoder] Error decoding struct field ${field.name}:`, e);
        result[field.name] = null;
      }
    }
    return result;
  }

  // MESSAGE type - fields are optional with field IDs
  if (def.kind === 'MESSAGE') {
    const fieldMap = new Map<number, Field>();
    for (const field of def.fields) {
      fieldMap.set(field.value, field);
    }

    while (bb.remaining > 0) {
      const fieldId = bb.readVarUint();
      if (fieldId === 0) break;

      const field = fieldMap.get(fieldId);
      if (field) {
        try {
          result[field.name] = decodeValue(bb, field.type as string, field.isArray, defMap);
        } catch (e) {
          console.warn(`[figma-kiwi-decoder] Error decoding message field ${field.name}:`, e);
          break;
        }
      } else {
        // Unknown field - we can't skip it properly without knowing the type
        console.warn(`[figma-kiwi-decoder] Unknown field ID: ${fieldId} in ${def.name}`);
        break;
      }
    }
    return result;
  }

  return result;
}

/**
 * Convert Figma message to simplified node structure
 */
export interface FigmaNode {
  guid?: { sessionID: number; localID: number };
  parentIndex?: { guid?: { sessionID: number; localID: number }; position?: string };
  type?: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: string;
  size?: { x: number; y: number };
  transform?: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number };

  // Fill & Stroke
  fillPaints?: unknown[];
  strokePaints?: unknown[];
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  dashPattern?: number[];

  // Individual border weights
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  borderStrokeWeightsIndependent?: boolean;

  // Corner radius
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;

  // Effects
  effects?: unknown[];

  // Text properties
  fontSize?: number;
  fontName?: { family: string; style: string; postscript: string };
  textData?: { characters: string };
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: { value: number; units: string };
  letterSpacing?: { value: number; units: string };
  textCase?: string;
  textDecoration?: string;
  paragraphIndent?: number;
  paragraphSpacing?: number;
  textTruncation?: string;
  maxLines?: number;

  // Auto-layout properties
  stackMode?: string;
  stackSpacing?: number;
  stackPadding?: number;
  stackHorizontalPadding?: number;
  stackVerticalPadding?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  stackPrimarySizing?: string;
  stackCounterSizing?: string;
  stackChildPrimaryGrow?: number;
  stackChildAlignSelf?: string;
  stackPositioning?: string;
  stackReverseZIndex?: boolean;
  stackWrap?: string;

  // Constraints
  horizontalConstraint?: string;
  verticalConstraint?: string;

  // Clipping
  clipsContent?: boolean;
  frameMaskDisabled?: boolean;

  // Other
  count?: number;
  [key: string]: unknown;
}

export function extractNodes(message: Record<string, unknown>): FigmaNode[] {
  const nodes: FigmaNode[] = [];

  // Try to extract node changes from message
  const nodeChanges = message.nodeChanges as unknown[];
  if (Array.isArray(nodeChanges)) {
    console.log('[figma-kiwi-decoder] === NODE CHANGES DEBUG ===');
    for (let i = 0; i < nodeChanges.length; i++) {
      const change = nodeChanges[i];
      if (change && typeof change === 'object') {
        const nodeObj = change as Record<string, unknown>;
        // Log all keys to see what fields are available
        console.log(`[figma-kiwi-decoder] Node ${i}: ${nodeObj.type} "${nodeObj.name}"`);
        console.log(`[figma-kiwi-decoder]   Keys: ${Object.keys(nodeObj).join(', ')}`);
        // Look for parent-related fields - parentIndex has nested guid structure
        if ('parentIndex' in nodeObj && nodeObj.parentIndex) {
          const pi = nodeObj.parentIndex as { guid?: { sessionID?: number; localID?: number } };
          if (pi.guid) {
            console.log(`[figma-kiwi-decoder]   parentIndex.guid: ${pi.guid.sessionID}:${pi.guid.localID}`);
          }
        }
        if ('guid' in nodeObj && nodeObj.guid) {
          const g = nodeObj.guid as { sessionID?: number; localID?: number };
          console.log(`[figma-kiwi-decoder]   guid: ${g.sessionID}:${g.localID}`);
        }
        // Log auto-layout properties if present
        if ('stackMode' in nodeObj) {
          console.log(`[figma-kiwi-decoder]   auto-layout: mode=${nodeObj.stackMode} spacing=${nodeObj.stackSpacing} padding=${nodeObj.stackPadding}`);
        }
        // Log text properties if present
        if ('textAlignHorizontal' in nodeObj || 'lineHeight' in nodeObj) {
          const lh = nodeObj.lineHeight as { value?: number; units?: string } | undefined;
          const ls = nodeObj.letterSpacing as { value?: number; units?: string } | undefined;
          console.log(`[figma-kiwi-decoder]   text: align=${nodeObj.textAlignHorizontal} lineHeight=${lh?.value}${lh?.units} letterSpacing=${ls?.value}${ls?.units}`);
        }
        // Log fill paints details for debugging image detection
        if ('fillPaints' in nodeObj && Array.isArray(nodeObj.fillPaints)) {
          for (let j = 0; j < nodeObj.fillPaints.length; j++) {
            const paint = nodeObj.fillPaints[j] as Record<string, unknown>;
            const paintKeys = Object.keys(paint);
            console.log(`[figma-kiwi-decoder]   fillPaint[${j}]: type=${paint.type} keys=[${paintKeys.join(', ')}]`);
            // Log all values for IMAGE type or unknown types
            if (paint.type === 'IMAGE' || paintKeys.includes('imageHash') || paintKeys.includes('imageRef')) {
              console.log(`[figma-kiwi-decoder]   IMAGE paint detail:`, JSON.stringify(paint, (_, v) => {
                if (v instanceof Uint8Array) return `<Uint8Array(${v.length})>`;
                return v;
              }, 2).substring(0, 500));
            }
          }
        }
        nodes.push(nodeObj as FigmaNode);
      }
    }
    console.log('[figma-kiwi-decoder] === END NODE CHANGES DEBUG ===');
  }

  return nodes;
}
