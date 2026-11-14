# Visual passes on the studio photograph

These passes use the labelled studio still in headless Chromium. They are not a person on a camera, and they are not a claim that cloth or hair was simulated. Pixel checks below were measured on the saved frames.

## Pass 1

The fedora crown sat over the eyes. `hatSprite` placed the brim with a factor of 0.22, so most of the photograph hung below the forehead. The cap, at 0.36, already sat with the brim above the eyes.

The honey-bob and espresso-wave plates showed no lime pixels in the portrait crop (green minus the stronger of red and blue stayed at or below 4 out of 255). The source cut-outs do contain a green matte. The sprite shader was already dropping the strong matte. What remains is the photograph's own face hole, not a grown hairline.

Sand linen replaced the torso on the chest-up still. The dress bodice did the same. Feet are not in that still, so the pedicure estimate correctly drew nothing and said only the foot-index point is tracked.

## Pass 2

The fedora brim factor is now 0.46. On the same still the tan crown starts about 44 pixels higher than in pass 1, and the eyes stay visible under the brim. The cap factor was left at 0.36.

The sprite shader now also pulls a small green excess out of the colour before it fades the pixel, so a filtered matte edge does not stay lime. A recount of the honey bob and the espresso wave still found no spill above 4 out of 255.

## What a later pass would still have to do

- The wig is one photograph. The face hole is the cut-out in that file. It is not a hair mesh, and a real turn was not filmed.
- A chest-up still cannot show a skirt hem, trouser legs, or toenails. The pedicure plates exist in code and only appear when the ankle, heel, and foot-index are in frame. Four of the five plates are a spacing estimate.
- An arbitrary shop picture is a low-confidence shape guess. The shopper confirms the category. There is no cut-out model.
