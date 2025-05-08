/**
 * Extracts the Authorization header value from a headers object.
 *
 * @param headersObject An object or Headers instance containing request headers.
 * @returns The Authorization header value as a string, or null if not found.
 */
export function extractUserName(headersObject: any): string | null {
  let authorizationHeader: string | null = null;

  if (headersObject) {
    if (typeof headersObject.get === 'function') {
        // Standard Headers object
        authorizationHeader = headersObject.get('Authorization') || headersObject.get('authorization');
    } else if (typeof headersObject === 'object' && headersObject !== null) {
        // Plain object (case-insensitive lookup)
        const lowerCaseHeaders: { [key: string]: string } = {};
        for (const key in headersObject) {
            if (Object.prototype.hasOwnProperty.call(headersObject, key)) {
                const value = headersObject[key];
                lowerCaseHeaders[key.toLowerCase()] = typeof value === 'string' ? value : String(value);
            }
        }
        authorizationHeader = lowerCaseHeaders['authorization'];
    } else {
        console.warn("Provided headers object structure is unrecognized. Type:", typeof headersObject);
        // Return null if headersObject structure is unrecognized
        return null;
    }
  }

  if (authorizationHeader) {
      console.log("Found Authorization header:", authorizationHeader);
      const parts = authorizationHeader.split(' ');
      // Check if it's a Bearer token and has two parts
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) {
          console.log("Extracted token:", parts[1]);
          return parts[1]; // Return only the token part
      } else {
          console.log("Authorization header is not a valid Bearer token or is malformed.");
          // Return null if not a valid Bearer token format
          return null;
      }
  } else {
      console.log("Authorization header not found.");
      return null;
  }
}

/**
 * Generates a strong ETag using a SHA-1 hash of the JSON representation of an object.
 * @param state The object representing the resource state.
 * @returns A Promise resolving to the strong ETag string (e.g., "<sha1-hex>").
 */
export async function generateStrongETag<T extends object>(state: T): Promise<string> {
  // Ensure consistent ordering for stringification if possible, though default usually suffices
  const stateString = JSON.stringify(state);
  const encoder = new TextEncoder();
  const data = encoder.encode(stateString);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `"${hashHex}"`; // Strong ETag format
} 