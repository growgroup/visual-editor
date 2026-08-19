/**
 * figma-kiwi-encoder.ts
 *
 * Encodes data into Figma's kiwi binary format for clipboard export.
 * This is the reverse of figma-kiwi-decoder.ts
 */

import * as pako from 'pako';

/**
 * WriteBuffer for encoding binary data in kiwi format
 */
export class WriteBuffer {
  private chunks: Uint8Array[] = [];
  private currentChunk: Uint8Array;
  private index: number = 0;
  private static CHUNK_SIZE = 4096;

  constructor() {
    this.currentChunk = new Uint8Array(WriteBuffer.CHUNK_SIZE);
  }

  private ensureCapacity(bytes: number): void {
    if (this.index + bytes > this.currentChunk.length) {
      // Save current chunk and allocate new one
      this.chunks.push(this.currentChunk.slice(0, this.index));
      this.currentChunk = new Uint8Array(Math.max(WriteBuffer.CHUNK_SIZE, bytes));
      this.index = 0;
    }
  }

  writeByte(value: number): void {
    this.ensureCapacity(1);
    this.currentChunk[this.index++] = value & 0xFF;
  }

  writeVarUint(value: number): void {
    value = value >>> 0; // Convert to unsigned 32-bit
    while (value > 0x7F) {
      this.writeByte((value & 0x7F) | 0x80);
      value >>>= 7;
    }
    this.writeByte(value);
  }

  writeVarInt(value: number): void {
    // Zig-zag encoding
    this.writeVarUint(value < 0 ? (~value << 1) | 1 : value << 1);
  }

  /**
   * Write null-terminated UTF-8 string (kiwi format)
   */
  writeString(value: string): void {
    for (let i = 0; i < value.length; i++) {
      let codePoint = value.charCodeAt(i);

      // Handle surrogate pairs
      if (codePoint >= 0xD800 && codePoint <= 0xDBFF && i + 1 < value.length) {
        const low = value.charCodeAt(i + 1);
        if (low >= 0xDC00 && low <= 0xDFFF) {
          codePoint = 0x10000 + ((codePoint - 0xD800) << 10) + (low - 0xDC00);
          i++;
        }
      }

      // Encode UTF-8
      if (codePoint < 0x80) {
        this.writeByte(codePoint);
      } else if (codePoint < 0x800) {
        this.writeByte(0xC0 | (codePoint >> 6));
        this.writeByte(0x80 | (codePoint & 0x3F));
      } else if (codePoint < 0x10000) {
        this.writeByte(0xE0 | (codePoint >> 12));
        this.writeByte(0x80 | ((codePoint >> 6) & 0x3F));
        this.writeByte(0x80 | (codePoint & 0x3F));
      } else {
        this.writeByte(0xF0 | (codePoint >> 18));
        this.writeByte(0x80 | ((codePoint >> 12) & 0x3F));
        this.writeByte(0x80 | ((codePoint >> 6) & 0x3F));
        this.writeByte(0x80 | (codePoint & 0x3F));
      }
    }
    // Null terminator
    this.writeByte(0);
  }

  /**
   * Write variable-length float (kiwi optimization format)
   */
  writeVarFloat(value: number): void {
    if (value === 0) {
      this.writeByte(0);
      return;
    }

    // Reinterpret as 32-bit integer
    const float32 = new Float32Array(1);
    const int32 = new Int32Array(float32.buffer);
    float32[0] = value;
    let bits = int32[0];

    // Rotate exponent to low bits for better compression
    bits = (bits >>> 23) | (bits << 9);

    // Write 4 bytes little-endian
    this.ensureCapacity(4);
    this.currentChunk[this.index++] = bits & 0xFF;
    this.currentChunk[this.index++] = (bits >> 8) & 0xFF;
    this.currentChunk[this.index++] = (bits >> 16) & 0xFF;
    this.currentChunk[this.index++] = (bits >> 24) & 0xFF;
  }

  /**
   * Write length-prefixed byte array
   */
  writeByteArray(value: Uint8Array): void {
    this.writeVarUint(value.length);
    this.ensureCapacity(value.length);
    this.currentChunk.set(value, this.index);
    this.index += value.length;
  }

  /**
   * Write a double (8 bytes, little endian)
   */
  writeDouble(value: number): void {
    const float64 = new Float64Array(1);
    float64[0] = value;
    const bytes = new Uint8Array(float64.buffer);
    this.ensureCapacity(8);
    for (let i = 0; i < 8; i++) {
      this.currentChunk[this.index++] = bytes[i];
    }
  }

  /**
   * Get the final buffer
   */
  toUint8Array(): Uint8Array {
    // Combine all chunks
    const totalLength = this.chunks.reduce((sum, c) => sum + c.length, 0) + this.index;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    result.set(this.currentChunk.slice(0, this.index), offset);
    return result;
  }
}

/**
 * Schema definition types (matching decoder)
 */
interface Field {
  name: string;
  type: string | number | null;
  isArray: boolean;
  value: number; // field ID for MESSAGE types
}

interface Definition {
  name: string;
  kind: string; // 'ENUM' | 'STRUCT' | 'MESSAGE'
  fields: Field[];
}

export interface Schema {
  definitions: Definition[];
}

/**
 * Bundled default schema (captured from Figma paste)
 * This is the raw compressed schema bytes as base64
 * TODO: Replace with actual schema after capturing from Figma paste
 */
const BUNDLED_SCHEMA_BASE64: string | null = null; // Will be set after capture

/**
 * Cached schema from previous Figma paste operation
 */
let cachedSchema: Schema | null = null;
let cachedSchemaRaw: Uint8Array | null = null;
let bundledSchemaInitialized = false;

/**
 * Cache the schema from a decode operation for later use in encoding
 */
export function cacheSchema(schema: Schema, rawSchemaBytes?: Uint8Array): void {
  cachedSchema = schema;
  if (rawSchemaBytes) {
    cachedSchemaRaw = rawSchemaBytes;
  }
  console.log('[figma-kiwi-encoder] Schema cached with', schema.definitions.length, 'definitions');
}

/**
 * Get the cached schema
 */
export function getCachedSchema(): Schema | null {
  return cachedSchema;
}

/**
 * Get the cached raw schema bytes
 */
export function getCachedSchemaRaw(): Uint8Array | null {
  return cachedSchemaRaw;
}

/**
 * Encode a value based on its type
 */
function encodeValue(
  bb: WriteBuffer,
  value: unknown,
  typeName: string | null,
  isArray: boolean,
  defMap: Map<string, Definition>
): void {
  if (isArray) {
    const arr = value as unknown[];
    bb.writeVarUint(arr.length);
    for (const item of arr) {
      encodeValue(bb, item, typeName, false, defMap);
    }
    return;
  }

  switch (typeName) {
    case 'bool':
      bb.writeByte((value as boolean) ? 1 : 0);
      break;
    case 'byte':
      bb.writeByte(value as number);
      break;
    case 'int':
    case 'int64':
      bb.writeVarInt(value as number);
      break;
    case 'uint':
    case 'uint64':
      bb.writeVarUint(value as number);
      break;
    case 'float':
      bb.writeVarFloat(value as number);
      break;
    case 'double':
      bb.writeDouble(value as number);
      break;
    case 'string':
      bb.writeString(value as string);
      break;
    case 'bytes':
      bb.writeByteArray(value as Uint8Array);
      break;
    default:
      // Check if it's a reference to another definition
      if (typeName && defMap.has(typeName)) {
        const def = defMap.get(typeName)!;
        if (def.kind === 'ENUM') {
          // Find the enum value by name
          const enumName = value as string;
          for (const field of def.fields) {
            if (field.name === enumName) {
              bb.writeVarUint(field.value);
              return;
            }
          }
          // Default to 0 if not found
          console.warn(`[figma-kiwi-encoder] Unknown enum value: ${enumName} in ${typeName}`);
          bb.writeVarUint(0);
        } else {
          encodeStruct(bb, value as Record<string, unknown>, def, defMap);
        }
      } else {
        console.warn(`[figma-kiwi-encoder] Unknown type: ${typeName}`);
      }
  }
}

/**
 * Encode a struct or message
 */
function encodeStruct(
  bb: WriteBuffer,
  obj: Record<string, unknown>,
  def: Definition,
  defMap: Map<string, Definition>
): void {
  if (def.kind === 'STRUCT') {
    // STRUCT: all fields in order
    for (const field of def.fields) {
      const value = obj[field.name];
      if (value !== undefined && value !== null) {
        encodeValue(bb, value, field.type as string, field.isArray, defMap);
      } else {
        // Write default value
        encodeDefaultValue(bb, field.type as string, field.isArray, defMap);
      }
    }
  } else if (def.kind === 'MESSAGE') {
    // MESSAGE: optional fields with field IDs
    for (const field of def.fields) {
      const value = obj[field.name];
      if (value !== undefined && value !== null) {
        bb.writeVarUint(field.value); // field ID
        encodeValue(bb, value, field.type as string, field.isArray, defMap);
      }
    }
    // End of message marker
    bb.writeVarUint(0);
  }
}

/**
 * Encode default value for a type
 */
function encodeDefaultValue(
  bb: WriteBuffer,
  typeName: string,
  isArray: boolean,
  defMap: Map<string, Definition>
): void {
  if (isArray) {
    bb.writeVarUint(0); // empty array
    return;
  }

  switch (typeName) {
    case 'bool':
      bb.writeByte(0);
      break;
    case 'byte':
      bb.writeByte(0);
      break;
    case 'int':
    case 'int64':
      bb.writeVarInt(0);
      break;
    case 'uint':
    case 'uint64':
      bb.writeVarUint(0);
      break;
    case 'float':
      bb.writeVarFloat(0);
      break;
    case 'double':
      bb.writeDouble(0);
      break;
    case 'string':
      bb.writeString('');
      break;
    case 'bytes':
      bb.writeByteArray(new Uint8Array(0));
      break;
    default:
      if (typeName && defMap.has(typeName)) {
        const def = defMap.get(typeName)!;
        if (def.kind === 'ENUM') {
          bb.writeVarUint(0);
        } else if (def.kind === 'MESSAGE') {
          bb.writeVarUint(0); // empty message
        } else {
          encodeStruct(bb, {}, def, defMap);
        }
      }
  }
}

/**
 * Encode a Message with nodeChanges
 */
export function encodeMessage(
  nodeChanges: Record<string, unknown>[],
  schema: Schema
): Uint8Array {
  const bb = new WriteBuffer();

  // Build definition map
  const defMap = new Map<string, Definition>();
  for (const def of schema.definitions) {
    defMap.set(def.name, def);
  }

  // Find Message definition
  const messageDef = defMap.get('Message');
  if (!messageDef) {
    throw new Error('Message definition not found in schema');
  }

  // Create message object
  const sessionID = Math.floor(Math.random() * 1000000000);
  const pasteID = Math.floor(Math.random() * 1000000000);

  const message: Record<string, unknown> = {
    type: 'NODE_CHANGES',
    sessionID: sessionID,
    pasteID: pasteID,
    nodeChanges: nodeChanges,
  };

  console.log('[figma-kiwi-encoder] Message:', { type: 'NODE_CHANGES', sessionID, pasteID, nodeChangesCount: nodeChanges.length });

  // Encode the message
  encodeStruct(bb, message, messageDef, defMap);

  return bb.toUint8Array();
}

/**
 * Create fig-kiwi archive format
 */
export function createArchive(schemaCompressed: Uint8Array, dataCompressed: Uint8Array): Uint8Array {
  const prelude = new TextEncoder().encode('fig-kiwi');
  const version = 15; // Figma's current version

  // Calculate total size
  const totalSize = prelude.length + 4 + 4 + schemaCompressed.length + 4 + dataCompressed.length;
  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer);

  let offset = 0;

  // Write prelude
  result.set(prelude, offset);
  offset += prelude.length;

  // Write version (4 bytes, little endian)
  view.setUint32(offset, version, true);
  offset += 4;

  // Write schema chunk
  view.setUint32(offset, schemaCompressed.length, true);
  offset += 4;
  result.set(schemaCompressed, offset);
  offset += schemaCompressed.length;

  // Write data chunk
  view.setUint32(offset, dataCompressed.length, true);
  offset += 4;
  result.set(dataCompressed, offset);
  offset += dataCompressed.length;

  return result;
}

/**
 * Encode schema to binary format
 */
export function encodeBinarySchema(schema: Schema): Uint8Array {
  const bb = new WriteBuffer();

  // Write definition count
  bb.writeVarUint(schema.definitions.length);

  // Kind mapping
  const kindToIndex: Record<string, number> = {
    'ENUM': 0,
    'STRUCT': 1,
    'MESSAGE': 2,
  };

  // Build name to index map for type references
  const nameToIndex = new Map<string, number>();
  schema.definitions.forEach((def, index) => {
    nameToIndex.set(def.name, index);
  });

  // Extended types mapping (reverse)
  const typeNameToIndex: Record<string, number> = {
    'bool': -1,
    'byte': -2,
    'int': -3,
    'uint': -4,
    'float': -5,
    'string': -6,
    'int64': -7,
    'uint64': -8,
    'double': -9,
    'bytes': -10,
  };

  // Write each definition
  for (const def of schema.definitions) {
    bb.writeString(def.name);
    bb.writeByte(kindToIndex[def.kind] ?? 2);
    bb.writeVarUint(def.fields.length);

    for (const field of def.fields) {
      bb.writeString(field.name);

      // Encode type
      let typeIndex: number;
      if (field.type === null) {
        typeIndex = 0; // For ENUM fields
      } else if (typeof field.type === 'string') {
        if (typeNameToIndex[field.type] !== undefined) {
          typeIndex = typeNameToIndex[field.type];
        } else if (nameToIndex.has(field.type)) {
          typeIndex = nameToIndex.get(field.type)!;
        } else {
          console.warn(`[figma-kiwi-encoder] Unknown type reference: ${field.type}`);
          typeIndex = 0;
        }
      } else {
        typeIndex = field.type;
      }
      bb.writeVarInt(typeIndex);

      // isArray flag
      bb.writeByte(field.isArray ? 1 : 0);

      // field value/ID
      bb.writeVarUint(field.value);
    }
  }

  return bb.toUint8Array();
}

/**
 * Generate Figma clipboard HTML
 */
export function generateFigmaClipboardHtml(
  nodeChanges: Record<string, unknown>[],
  fileKey: string = 'export',
  schema?: Schema,
  previewText?: string
): string {
  const schemaToUse = schema || cachedSchema;
  if (!schemaToUse) {
    throw new Error('No schema available. Please paste from Figma first to cache the schema.');
  }

  // Encode message
  const messageData = encodeMessage(nodeChanges, schemaToUse);
  console.log('[figma-kiwi-encoder] Encoded message size:', messageData.length);

  // Compress data
  const dataCompressed = pako.deflateRaw(messageData);
  console.log('[figma-kiwi-encoder] Compressed data size:', dataCompressed.length);

  // Get or encode schema
  let schemaCompressed: Uint8Array;
  if (cachedSchemaRaw) {
    // Re-use cached raw schema (already in correct format)
    schemaCompressed = cachedSchemaRaw;
    console.log('[figma-kiwi-encoder] Using cached schema bytes');
  } else {
    // Encode schema
    const schemaData = encodeBinarySchema(schemaToUse);
    schemaCompressed = pako.deflateRaw(schemaData);
    console.log('[figma-kiwi-encoder] Encoded schema size:', schemaCompressed.length);
  }

  // Create archive
  const archive = createArchive(schemaCompressed, dataCompressed);
  console.log('[figma-kiwi-encoder] Archive size:', archive.length);

  // Encode to base64
  const binaryString = Array.from(archive).map(b => String.fromCharCode(b)).join('');
  const base64Data = btoa(binaryString);

  // Create metadata
  const meta = {
    fileKey: fileKey,
    pasteID: Math.floor(Math.random() * 1000000000),
    dataType: 'scene',
  };
  const base64Meta = btoa(JSON.stringify(meta));

  // Generate HTML with optional preview text (like Figma does)
  const previewSpan = previewText
    ? `<span style="white-space: pre-wrap;">${previewText}</span>`
    : '';
  const html = `<meta charset="utf-8"><span data-metadata="<!--(figmeta)${base64Meta}(/figmeta)-->"></span><span data-buffer="<!--(figma)${base64Data}(/figma)-->"></span>${previewSpan}`;

  console.log('[figma-kiwi-encoder] Generated clipboard HTML length:', html.length);
  return html;
}
