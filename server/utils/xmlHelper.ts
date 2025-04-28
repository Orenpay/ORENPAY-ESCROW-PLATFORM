// Basic XML helper for DPO integration
export function createXMLRequest(obj: Record<string, any>): string {
    // Very basic: converts a flat object to XML (no nested support)
    let xml = '<Request>';
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            xml += `<${key}>${obj[key]}</${key}>`;
        }
    }
    xml += '</Request>';
    return xml;
}

export function parseXMLResponse(xml: string): Record<string, any> {
    // Very basic: parses flat XML into an object (no nested support)
    const obj: Record<string, any> = {};
    const regex = /<([^\/][^>]*)>([^<]*)<\/\1>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
        obj[match[1]] = match[2];
    }
    return obj;
}