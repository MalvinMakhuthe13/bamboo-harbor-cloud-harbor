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

vec3 lumaTint(vec3 rgb) {
  if (uTintOn < 0.5) return rgb;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return uTint * (0.38 + l * 1.12);
}

vec3 shade(vec3 prod, vec3 cam) {
  float l = dot(cam, vec3(0.2126, 0.7152, 0.0722));
  return prod * clamp(0.8 + l * 0.42, 0.68, 1.2);
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

vec2 torsoSample(vec2 p) {
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
  if (v < 0.0 || v > 1.04 || abs(u) > 1.02) return vec2(-1.0);
  float tu = uFullTex > 0.5
    ? mix(0.04, 0.96, u * 0.5 + 0.5)
    : mix(0.2, 0.8, u * 0.5 + 0.5);
  float tv = mix(0.02, 0.98, clamp(v, 0.0, 1.0));
  return vec2(tu, 1.0 - tv);
}

vec2 armSample(vec2 p, vec2 sh, vec2 el, vec2 wr, float sideSign) {
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
  if (best > uArmW) return vec2(-1.0);
  float uLocal = clamp(across / max(uArmW, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  float tu = sideSign < 0.0 ? mix(0.02, 0.28, uLocal) : mix(0.72, 0.98, uLocal);
  float tv = mix(0.14, 0.82, along);
  return vec2(tu, 1.0 - tv);
}

vec2 hairSample(vec2 p, out float edge) {
  vec2 c = uHairC + uDrag;
  vec2 d = p - c;
  float x = d.x * uHairCos + d.y * uHairSin;
  float y = -d.x * uHairSin + d.y * uHairCos;
  float nx = x / max(uHairHalf.x, 1e-4);
  float ny = y / max(uHairHalf.y, 1e-4);
  float e = nx * nx + ny * ny;
  edge = smoothstep(1.0, 0.78, e);
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
    if (along > 0.42 && along < uNailTip && abs(across) < uNailHalf) {
      float side = smoothstep(uNailHalf, uNailHalf * 0.45, abs(across));
      float end = smoothstep(uNailTip, uNailTip - 0.22, along);
      m = max(m, side * end);
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
  bool other = cls > 4.5 && cls < 5.5;
  bool bg = cls >= 0.0 && cls < 0.5;
  bool protect = inEllipse(p, uProtectC, uProtectHalf, uHairCos, uHairSin);
  bool hand = nearHand(p);

  if (uMode == 1 && uHasMask > 0.5 && !protect && !(hand && (body || other))) {
    vec2 sampleUv = torsoSample(p);
    vec2 armL = vec2(-1.0);
    vec2 armR = vec2(-1.0);
    if (uHasArms > 0.5) {
      armL = armSample(p, uShL, uElbowL, uWristL, -1.0);
      armR = armSample(p, uShR, uElbowR, uWristR, 1.0);
    }
    bool inGeom = sampleUv.x >= 0.0 || armL.x >= 0.0 || armR.x >= 0.0;
    bool region = (clothes || other || (body && uCoverSkin > 0.5)) && !hair && !face && !bg;
    if (inGeom && region) {
      vec2 uv = sampleUv;
      if (uv.x < 0.0) {
        if (armL.x >= 0.0) uv = armL;
        if (armR.x >= 0.0) uv = armR;
      }
      vec4 prod = texture(uProd, uv);
      float green = prod.g - max(prod.r, prod.b);
      if (green > 0.22 && prod.g > 0.25) prod.a = 0.0;
      if (prod.a > 0.05) {
        vec3 lit = shade(lumaTint(prod.rgb), cam.rgb);
        rgb = mix(rgb, lit, prod.a);
      }
    }
  }

  if (uMode == 2 && uHasMask > 0.5 && !protect && !(hand && body)) {
    float edge = 0.0;
    vec2 huv = hairSample(p, edge);
    bool allow = huv.x >= 0.0 && !bg ? true : huv.x >= 0.0;
    if (face && protect) allow = false;
    if (huv.x >= 0.0 && edge > 0.0 && allow) {
      vec4 prod = texture(uProd, huv);
      float green = prod.g - max(prod.r, prod.b);
      if (green > 0.22 && prod.g > 0.25) prod.a = 0.0;
      if (prod.a > 0.04) {
        vec3 lit = shade(lumaTint(prod.rgb), cam.rgb);
        rgb = mix(rgb, lit, prod.a * edge);
      }
    }
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
uniform vec3 uTint;
uniform float uTintOn;
uniform float uLens;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 s = texture(uSprite, vUv);
  float green = s.g - max(s.r, s.b);
  if (green > 0.12 && s.g > 0.15) s.a *= clamp(1.0 - (green - 0.08) * 4.0, 0.0, 1.0);
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
