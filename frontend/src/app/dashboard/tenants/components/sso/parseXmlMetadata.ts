// src/app/dashboard/tenants/components/sso/parseXmlMetadata.ts

export const parseXmlMetadata = (xmlText: string) => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    
    const parserError = xmlDoc.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
      throw new Error("Invalid XML formatting");
    }

    let entityId = "";
    const entityDescriptor =
      xmlDoc.getElementsByTagName("EntityDescriptor")[0] ||
      xmlDoc.getElementsByTagName("md:EntityDescriptor")[0];
    if (entityDescriptor) {
      entityId = entityDescriptor.getAttribute("entityID") || "";
    }

    let entryPoint = "";
    const ssoServices =
      xmlDoc.getElementsByTagName("SingleSignOnService") ||
      xmlDoc.getElementsByTagName("md:SingleSignOnService");
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
    const certNodes =
      xmlDoc.getElementsByTagName("X509Certificate") ||
      xmlDoc.getElementsByTagName("ds:X509Certificate");
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
