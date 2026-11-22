const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function parseDataUrl(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const dataUrlMatch = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1].toLowerCase(),
      base64: dataUrlMatch[2],
      dataUrl: input,
    };
  }

  return {
    mimeType: "image/jpeg",
    base64: input.replace(/^data:.*;base64,/, ""),
    dataUrl: `data:image/jpeg;base64,${input}`,
  };
}

async function uploadImageToImgBB(imageData, fileName = "pizzahub-upload") {
  const parsed = parseDataUrl(imageData);
  if (!parsed || !parsed.base64) {
    const err = new Error("A valid image file is required for upload.");
    err.statusCode = 400;
    throw err;
  }

  if (!ALLOWED_MIME_TYPES.has(parsed.mimeType)) {
    const err = new Error("Unsupported image format. Please upload JPG, PNG, or WEBP.");
    err.statusCode = 400;
    throw err;
  }

  const estimatedBytes = Math.ceil((parsed.base64.length * 3) / 4);
  if (estimatedBytes > 5 * 1024 * 1024) {
    const err = new Error("Image size must be under 5 MB.");
    err.statusCode = 400;
    throw err;
  }

  const apiKey = (process.env.IMGBB_API_KEY || "").trim();
  if (!apiKey) {
    return {
      url: parsed.dataUrl,
      displayUrl: parsed.dataUrl,
      provider: "inline-fallback",
    };
  }

  const form = new URLSearchParams();
  form.append("key", apiKey);
  form.append("image", parsed.base64);
  form.append("name", fileName);

  const response = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body: form,
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success || !result?.data?.url) {
    const err = new Error(
      result?.error?.message || "Failed to upload image to ImgBB."
    );
    err.statusCode = 502;
    throw err;
  }

  return {
    url: result.data.display_url || result.data.url,
    displayUrl: result.data.display_url || result.data.url,
    deleteUrl: result.data.delete_url || null,
    provider: "imgbb",
  };
}

module.exports = {
  uploadImageToImgBB,
};
