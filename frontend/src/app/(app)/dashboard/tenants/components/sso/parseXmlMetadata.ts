// src/app/dashboard/tenants/components/sso/parseXmlMetadata.ts

export const parseXmlMetadata = (xmlText: string) => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    
    const parserError = xmlDoc.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
      throw new Error("Invalid XML formatting");
    }

    // F-66: match by LOCAL name in any namespace. SAML metadata is usually
    // prefixed (md:, ds:). getElementsByTagName matches the qualified name,
    // and an HTMLCollection is always truthy, so the old
    // `byTag("X") || byTag("md:X")` never reached its fallback: for prefixed
    // metadata the SSO URL and the signing certificate came back empty.
    const byLocalName = (name: string) => xmlDoc.getElementsByTagNameNS("*", name);

    let entityId = "";
    const entityDescriptor = byLocalName("EntityDescriptor")[0];
    if (entityDescriptor) {
      entityId = entityDescriptor.getAttribute("entityID") || "";
    }

    let entryPoint = "";
    const ssoServices = byLocalName("SingleSignOnService");
    for (let i = 0; i < ssoServices.length; i++) {
      const binding = ssoServices[i].getAttribute("Binding") || "";
      if (binding.includes("HTTP-Redirect")) {
        entryPoint = ssoServices[i].getAttribute("Location") || "";
        break;
      }
    }
    if (!entryPoint && ssoServices.length > 0) {
      entryPoint = ssoServices[0].getAttribute("Location") || "";
    }

    let cert = "";
    const certNodes = byLocalName("X509Certificate");
    if (certNodes.length > 0) {
      cert = certNodes[0].textContent?.trim() || "";
      if (cert && !cert.includes("-----BEGIN CERTIFICATE-----")) {
        cert = `-----BEGIN CERTIFICATE-----\n${cert.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----`;
      }
    }

    return { entityId, entryPoint, cert };
  } catch (err) {
    throw new Error("Failed to parse SAML XML Metadata. Ensure it is a valid IDP metadata XML file.");
  }
};
