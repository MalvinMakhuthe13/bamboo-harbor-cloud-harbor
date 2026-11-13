export const FULLSCREEN_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uCam;
uniform sampler2D uProd;
uniform sampler2D uMask;
uniform int uMode;
uniform float uHasMask;
uniform vec2 uShL;
uniform vec2 uShR;
uniform float uFullTex;
uniform float uHasArms;
uniform float uCoverSkin;
uniform vec2 uTopL;
uniform vec2 uTopR;
uniform vec2 uBotL;
uniform vec2 uBotR;
uniform vec2 uElbowL;
uniform vec2 uWristL;
uniform vec2 uElbowR;
uniform vec2 uWristR;
uniform float uArmW;
uniform float uYaw;
uniform float uFrontArm;
uniform vec2 uHairC;
uniform vec2 uHairHalf;
uniform float uHairCos;
uniform float uHairSin;
uniform vec2 uProtectC;
uniform vec2 uProtectHalf;
uniform vec2 uDrag;
uniform vec3 uTint;
uniform float uTintOn;
uniform vec2 uHand0;
uniform vec2 uHand1;
uniform float uHandR;
uniform float uHasHands;
uniform vec4 uNails[10];
uniform int uNailCount;
uniform vec3 uPolish;
uniform float uNailHalf;
uniform float uNailTip;
uniform float uNailStart;
uniform vec3 uBackdrop;
uniform float uHasProduct;

vec3 lumaTint(vec3 rgb) {
  if (uTintOn < 0.5) return rgb;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return uTint * (0.38 + l * 1.12);
}

float lum(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 shade(vec3 prod, vec3 cam, vec2 camUv, float wrap) {
  float l = lum(cam);
  float around = lum(texture(uCam, camUv + vec2(0.016, 0.0)).rgb);
  around += lum(texture(uCam, camUv - vec2(0.016, 0.0)).rgb);
  around += lum(texture(uCam, camUv + vec2(0.0, 0.02)).rgb);
  around += lum(texture(uCam, camUv - vec2(0.0, 0.02)).rgb);
  around = (around + l) / 5.0;
  float wrinkle = (l - around) * 7.0;
  float form = (around - 0.62) * 0.9;
  float scale = clamp(0.9 + wrinkle + form, 0.5, 1.3);
  return prod * scale * wrap;
}

float clsAt(vec2 camUv) {
  return texture(uMask, camUv).r * 255.0;
}

bool nearHand(vec2 p) {
  if (uHasHands < 0.5) return false;
  if (distance(p, uHand0) < uHandR) return true;
  if (distance(p, uHand1) < uHandR) return true;
  return false;
}

bool inEllipse(vec2 p, vec2 c, vec2 halfExt, float csn, float sn) {
  vec2 d = p - c;
  float x = d.x * csn + d.y * sn;
  float y = -d.x * sn + d.y * csn;
  float nx = x / max(halfExt.x, 1e-4);
  float ny = y / max(halfExt.y, 1e-4);
  return nx * nx + ny * ny <= 1.0;
}

vec2 torsoSample(vec2 p, float allowOutside) {
  vec2 top = (uTopL + uTopR) * 0.5;
  vec2 bot = (uBotL + uBotR) * 0.5;
  vec2 axis = bot - top;
  float len2 = dot(axis, axis);
  if (len2 < 1e-6) return vec2(-1.0);
  float len = sqrt(len2);
  vec2 n = axis / len;
  vec2 side = vec2(-n.y, n.x);
  float v = dot(p - top, n) / len;
  float halfT = length(uTopR - uTopL) * 0.5;
  float halfB = length(uBotR - uBotL) * 0.5;
  float clamped = clamp(v, 0.0, 1.0);
  float halfW = mix(halfT, halfB, clamped);
  vec2 midP = top + n * (len * clamped);
  float u = dot(p - midP, side) / max(halfW, 1e-4);
  bool outside = v < 0.0 || v > 1.0 || abs(u) > 0.96;
  if (outside && allowOutside < 0.5) return vec2(-1.0);
  if (outside) {
    v = clamp(v, 0.0, 1.0);
    u = clamp(u, -0.96, 0.96);
  }
  if (v < 0.08 && abs(u) < 0.12) return vec2(-1.0);
  float slide = clamp(uYaw, -0.85, 0.85);
  float across = clamp(u * 0.55 - slide * 0.18, -0.5, 0.5);
  float tu = mix(0.30, 0.70, across + 0.5);
  tu += sin(v * 24.0 + u * 5.0) * 0.012 * abs(slide);
  tu = clamp(tu, 0.30, 0.70);
  float bodyV = mix(0.16, 0.94, clamp((v - 0.08) / 0.92, 0.0, 1.0));
  float collarV = mix(0.02, 0.12, clamp(v / 0.08, 0.0, 1.0));
  float tv = v < 0.08 ? collarV : bodyV;
  return vec2(tu, 1.0 - tv);
}

vec3 armSample(vec2 p, vec2 sh, vec2 el, vec2 wr, float sideSign, float force) {
  vec2 a0 = sh;
  vec2 b0 = el;
  vec2 a1 = el;
  vec2 b1 = wr;
  float best = 1e3;
  float along = 0.0;
  float across = 0.0;
  float len0 = length(b0 - a0);
  float len1 = length(b1 - a1);
  float total = max(len0 + len1, 1e-4);
  vec2 ab = b0 - a0;
  float l2 = dot(ab, ab);
  float t = l2 < 1e-6 ? 0.0 : clamp(dot(p - a0, ab) / l2, 0.0, 1.0);
  vec2 q = a0 + ab * t;
  float d = length(p - q);
  if (d < best) {
    best = d;
    vec2 dir = l2 < 1e-6 ? vec2(0.0, 1.0) : ab / sqrt(l2);
    across = dot(p - q, vec2(-dir.y, dir.x));
    along = (t * len0) / total;
  }
  ab = b1 - a1;
  l2 = dot(ab, ab);
  t = l2 < 1e-6 ? 0.0 : clamp(dot(p - a1, ab) / l2, 0.0, 1.0);
  q = a1 + ab * t;
  d = length(p - q);
  if (d < best) {
    best = d;
    vec2 dir = l2 < 1e-6 ? vec2(0.0, 1.0) : ab / sqrt(l2);
    across = dot(p - q, vec2(-dir.y, dir.x));
    along = (len0 + t * len1) / total;
  }
  if (best > uArmW && force < 0.5) return vec3(-1.0, -1.0, 1e3);
  float uLocal = clamp(across / max(uArmW, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  float tu = sideSign < 0.0 ? mix(0.02, 0.28, uLocal) : mix(0.72, 0.98, uLocal);
  float tv = mix(0.2, 0.9, along);
  return vec3(tu, 1.0 - tv, best);
}

vec2 hairSample(vec2 p, out float edge) {
  vec2 c = uHairC + uDrag;
  vec2 d = p - c;
  float x = d.x * uHairCos + d.y * uHairSin;
  float y = -d.x * uHairSin + d.y * uHairCos;
  float nx = x / max(uHairHalf.x, 1e-4);
  float ny = y / max(uHairHalf.y, 1e-4);
  float e = nx * nx + ny * ny;
  edge = 1.0 - smoothstep(0.78, 1.0, e);
  if (e > 1.0) return vec2(-1.0);
  return vec2(nx * 0.5 + 0.5, 0.5 - ny * 0.5);
}

float nailMask(vec2 p) {
  float m = 0.0;
  for (int i = 0; i < 10; i++) {
    if (i >= uNailCount) break;
    vec2 base = uNails[i].zw;
    vec2 tip = uNails[i].xy;
    vec2 ab = tip - base;
    float L = length(ab);
    if (L < 1e-4) continue;
    vec2 dir = ab / L;
    vec2 d = p - base;
    float along = dot(d, dir) / L;
    float across = dot(d, vec2(-dir.y, dir.x)) / L;
    float taper = mix(0.86, 0.58, smoothstep(uNailStart, uNailTip, along));
    float halfWidth = uNailHalf * taper;
    if (along > uNailStart && along < uNailTip && abs(across) < halfWidth) {
      float side = 1.0 - smoothstep(halfWidth * 0.78, halfWidth, abs(across));
      float root = smoothstep(uNailStart, uNailStart + 0.035, along);
      float end = 1.0 - smoothstep(uNailTip - 0.035, uNailTip, along);
      m = max(m, side * root * end);
    }
  }
  return m;
}

void main() {
  vec2 p = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  vec2 camUv = vec2(p.x, 1.0 - p.y);
  vec4 cam = texture(uCam, camUv);
  vec3 rgb = cam.rgb;
  float cls = uHasMask > 0.5 ? clsAt(camUv) : -1.0;
  bool face = cls > 2.5 && cls < 3.5;
  bool hair = cls > 0.5 && cls < 1.5;
  bool body = cls > 1.5 && cls < 2.5;
  bool clothes = cls > 3.5 && cls < 4.5;
  bool protect = inEllipse(p, uProtectC, uProtectHalf, uHairCos, uHairSin);
  bool hand = nearHand(p);

  if (uMode == 1 && uHasMask > 0.5 && !protect && !hand) {
    vec2 sampleUv = torsoSample(p, 0.0);
    vec3 armL = vec3(-1.0, -1.0, 1e3);
    vec3 armR = vec3(-1.0, -1.0, 1e3);
    if (uHasArms > 0.5) {
      armL = armSample(p, uShL, uElbowL, uWristL, -1.0, 0.0);
      armR = armSample(p, uShR, uElbowR, uWristR, 1.0, 0.0);
      if (uFrontArm > 0.5) armL.z *= 0.72;
      if (uFrontArm < -0.5) armR.z *= 0.72;
    }
    bool inArm = uHasArms > 0.5 && min(armL.z, armR.z) < 100.0;
    // The front panel is worn on the torso. A sleeve uses the nearer arm, so the
    // two sides do not trade places when the arms cross.
    bool torsoCloth = sampleUv.x >= 0.0 && !inArm && !hair && !face && (clothes || body);
    bool sleeveCloth = inArm && clothes && !hair && !face;
    // Clothes the panel missed still belong to the new shirt. Leaving them shows the old one.
    bool missed = clothes && !torsoCloth && !sleeveCloth && !hair && !face;
    if (torsoCloth || sleeveCloth || missed) {
      vec2 sleeveUv = armL.z <= armR.z ? armL.xy : armR.xy;
      vec2 uv = missed ? torsoSample(p, 1.0) : (torsoCloth ? sampleUv : sleeveUv);
      if (missed && uHasArms > 0.5) {
        float midX = (uShL.x + uShR.x) * 0.5;
        if (abs(p.x - midX) > length(uShR - uShL) * 0.42) {
          vec3 forced = p.x < midX
            ? armSample(p, uShL, uElbowL, uWristL, -1.0, 1.0)
            : armSample(p, uShR, uElbowR, uWristR, 1.0, 1.0);
          if (forced.x >= 0.0) uv = forced.xy;
        }
      }
      vec4 prod = texture(uProd, uv);
      float green = prod.g - max(prod.r, prod.b);
      if (green > 0.22 && prod.g > 0.25) prod.a = 0.0;
      float peak = max(prod.r, max(prod.g, prod.b));
      float sat = peak - min(prod.r, min(prod.g, prod.b));
      if (peak < 0.09 && sat < 0.06) prod = texture(uProd, mix(uv, vec2(0.5, 0.42), 0.7));
      if (prod.a > 0.2) {
        // A clothes pixel is fully replaced. Fading it brings the old shirt back as a pale rim.
        float edge = clothes ? 1.0 : 0.92;
        float side = clamp(abs(uv.x - 0.5) / 0.2, 0.0, 1.0);
        float wrap = torsoCloth ? mix(1.0, 0.76, side * side) : 0.9;
        vec3 lit = shade(lumaTint(prod.rgb), cam.rgb, camUv, wrap);
        rgb = mix(rgb, lit, prod.a * edge);
      }
    }
  }

  // The wig photograph is drawn afterwards as a cut-out plate. This only removes the shopper's own hair class so it does not stick out around that plate. It is not a new hair mesh.
  if (uMode == 2 && uHasMask > 0.5 && hair && !protect) {
    float soften = 1.0;
    float hr = clsAt(camUv + vec2(0.007, 0.0));
    float hl = clsAt(camUv - vec2(0.007, 0.0));
    float hu = clsAt(camUv + vec2(0.0, 0.007));
    float hd = clsAt(camUv - vec2(0.0, 0.007));
    if (!(hr > 0.5 && hr < 1.5)) soften = min(soften, 0.62);
    if (!(hl > 0.5 && hl < 1.5)) soften = min(soften, 0.62);
    if (!(hu > 0.5 && hu < 1.5)) soften = min(soften, 0.62);
    if (!(hd > 0.5 && hd < 1.5)) soften = min(soften, 0.62);
    rgb = mix(rgb, uBackdrop, 0.88 * soften);
  }

  if (uNailCount > 0) {
    float m = nailMask(p);
    if (m > 0.0) {
      float l = dot(cam.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 gloss = uPolish * (0.5 + l * 0.95);
      vec3 polished = mix(cam.rgb, gloss, 0.8);
      rgb = mix(rgb, polished, m);
    }
  }

  o = vec4(rgb, 1.0);
}
`;

export const SPRITE_VERT = `#version 300 es
layout(location=0) in vec2 aClip;
layout(location=1) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aClip, 0.0, 1.0);
}
`;

export const SPRITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSprite;
uniform sampler2D uMask;
uniform vec3 uTint;
uniform float uTintOn;
uniform float uLens;
uniform float uHasMask;
uniform float uOcclude;
uniform vec2 uResolution;
uniform vec2 uHand0;
uniform vec2 uHand1;
uniform float uHandR;
uniform float uHasHands;
in vec2 vUv;
out vec4 o;

float clsAt(vec2 camUv) {
  return texture(uMask, camUv).r * 255.0;
}

void main() {
  vec2 fragUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  vec2 p = vec2(1.0 - fragUv.x, 1.0 - fragUv.y);
  vec2 camUv = vec2(p.x, fragUv.y);
  bool nearHand = uHasHands > 0.5 && (distance(p, uHand0) < uHandR || distance(p, uHand1) < uHandR);
  if (uOcclude > 0.5 && uHasMask > 0.5) {
    float cls = clsAt(camUv);
    bool face = cls > 2.5 && cls < 3.5;
    if (face || nearHand) discard;
  }
  vec4 s = texture(uSprite, vUv);
  float green = s.g - max(s.r, s.b);
  if (green > 0.05 && s.g > 0.12) s.a *= clamp(1.0 - green * 10.0, 0.0, 1.0);
  float luma = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(s.r, max(s.g, s.b)) - min(s.r, min(s.g, s.b));
  if (uLens > 0.5 && luma < 0.2 && sat < 0.08) s.a *= 0.28;
  if (s.a < 0.04) discard;
  vec3 rgb = s.rgb;
  if (uTintOn > 0.5) {
    float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = uTint * (0.35 + l * 1.15);
  }
  o = vec4(rgb, s.a);
}
`;


export const GARMENT_MESH_VERT = `#version 300 es
layout(location=0) in vec2 aClip;
layout(location=1) in vec2 aUv;
out vec2 vUv;
out vec2 vScreen;
out vec2 vMaskUv;
void main() {
  vUv = aUv;
  vScreen = vec2(1.0 - (aClip.x + 1.0) * 0.5, (1.0 - aClip.y) * 0.5);
  vMaskUv = vec2(vScreen.x, 1.0 - vScreen.y);
  gl_Position = vec4(aClip, 0.0, 1.0);
}
`;

export const GARMENT_MESH_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vScreen;
in vec2 vMaskUv;
out vec4 o;
uniform sampler2D uProduct;
uniform sampler2D uMask;
uniform sampler2D uCamera;
uniform float uHasMask;
uniform float uHasFace;
uniform vec2 uInvResolution;
uniform vec2 uHand0;
uniform vec2 uHand1;
uniform float uHandR;
uniform float uHasHands;
uniform vec2 uProtectC;
uniform vec2 uProtectHalf;
uniform float uProtectCos;
uniform float uProtectSin;
uniform vec3 uTint;
uniform float uTintOn;

float clsAt(vec2 uv) {
  return texture(uMask, uv).r * 255.0;
}
bool nearHand(vec2 p) {
  if (uHasHands < 0.5) return false;
  return distance(p, uHand0) < uHandR || distance(p, uHand1) < uHandR;
}
bool protectedFace(vec2 p) {
  if (uHasFace < 0.5) return false;
  vec2 d = p - uProtectC;
  float x = d.x * uProtectCos + d.y * uProtectSin;
  float y = -d.x * uProtectSin + d.y * uProtectCos;
  vec2 n = vec2(x / max(uProtectHalf.x, 1e-4), y / max(uProtectHalf.y, 1e-4));
  return dot(n, n) <= 1.0;
}
vec3 shade(vec3 product, vec3 camera) {
  float light = dot(camera, vec3(0.2126, 0.7152, 0.0722));
  vec3 tinted = product;
  if (uTintOn > 0.5) {
    float sourceLuma = dot(product, vec3(0.2126, 0.7152, 0.0722));
    tinted = uTint * (0.38 + sourceLuma * 1.12);
  }
  return tinted * clamp(0.8 + light * 0.42, 0.68, 1.2);
}
void main() {
  if (uHasMask < 0.5 || protectedFace(vScreen) || nearHand(vScreen)) discard;
  float cls = clsAt(vMaskUv);
  bool body = cls > 1.5 && cls < 2.5;
  bool clothes = cls > 3.5 && cls < 4.5;
  bool other = cls > 4.5 && cls < 5.5;
  if (!(body || clothes || other)) discard;

  vec4 product = texture(uProduct, vUv);
  if (product.a < 0.12) discard;
  float green = product.g - max(product.r, product.b);
  if (green > 0.22 && product.g > 0.25) discard;

  float edge = 1.0;
  if (clsAt(vMaskUv + vec2(uInvResolution.x * 2.0, 0.0)) < 0.5) edge = min(edge, 0.5);
  if (clsAt(vMaskUv - vec2(uInvResolution.x * 2.0, 0.0)) < 0.5) edge = min(edge, 0.5);
  if (clsAt(vMaskUv + vec2(0.0, uInvResolution.y * 2.0)) < 0.5) edge = min(edge, 0.5);
  if (clsAt(vMaskUv - vec2(0.0, uInvResolution.y * 2.0)) < 0.5) edge = min(edge, 0.5);

  vec3 camera = texture(uCamera, vMaskUv).rgb;
  vec3 rgb = shade(product.rgb, camera);
  o = vec4(rgb, product.a * edge);
}
`;
