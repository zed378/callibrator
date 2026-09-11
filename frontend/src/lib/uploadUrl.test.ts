import {
  toSameOriginUpload,
  avatarSrc,
  avatarImageProps,
  DEFAULT_AVATAR_SRC,
} from "./uploadUrl";

describe("toSameOriginUpload", () => {
  it("strips the backend origin from an absolute upload URL", () => {
    expect(
      toSameOriginUpload("http://localhost:5000/uploads/profile/x.jpg"),
    ).toBe("/uploads/profile/x.jpg");
  });

  it("keeps the query string", () => {
    expect(toSameOriginUpload("http://host/uploads/a.jpg?v=2")).toBe(
      "/uploads/a.jpg?v=2",
    );
  });

  it("leaves an already-relative upload path alone", () => {
    expect(toSameOriginUpload("/uploads/profile/x.jpg")).toBe(
      "/uploads/profile/x.jpg",
    );
  });

  it("returns a non-upload URL untouched", () => {
    expect(toSameOriginUpload("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
  });
});

describe("avatarSrc", () => {
  it("uses the uploaded picture when there is one", () => {
    expect(avatarSrc("http://localhost:5000/uploads/profile/x.jpg")).toBe(
      "/uploads/profile/x.jpg",
    );
  });

  // The backend reports "no avatar" as null — it does NOT send a URL for the
  // default.svg sentinel, because nothing serves that file. The placeholder is
  // the frontend's own static asset.
  it.each([null, undefined, ""])("falls back to the default for %p", (v) => {
    expect(avatarSrc(v as string | null | undefined)).toBe(DEFAULT_AVATAR_SRC);
  });
});

describe("avatarImageProps", () => {
  // Regression: next/image routes every src through /_next/image, which
  // answers 400 for SVG unless images.dangerouslyAllowSVG is set. Without
  // `unoptimized` the placeholder renders as a broken image — the exact bug it
  // was added to fix. Verified against the built container:
  //   GET /default-avatar.svg                    -> 200 image/svg+xml
  //   GET /_next/image?url=%2Fdefault-avatar.svg -> 400
  it("bypasses the image optimizer for the SVG placeholder", () => {
    expect(avatarImageProps(null)).toEqual({
      src: DEFAULT_AVATAR_SRC,
      unoptimized: true,
    });
  });

  // Uploaded avatars must keep going through the optimizer: that is what stops
  // a user-supplied SVG from being served as active content.
  it("optimizes an uploaded avatar", () => {
    expect(
      avatarImageProps("http://localhost:5000/uploads/profile/x.jpg"),
    ).toEqual({
      src: "/uploads/profile/x.jpg",
      unoptimized: false,
    });
  });
});
