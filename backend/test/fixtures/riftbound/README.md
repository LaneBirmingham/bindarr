# Riftbound camera regression fixtures

These are rectangular crops of the owner's real camera capture of a monitor
displaying four sleeved Riftbound cards, originally recorded by binder-scout as
`four_poros/original.jpg`. They are camera images with perspective, screen moire,
glare and sleeve borders, rather than catalogue-art transformations. They do not
establish accuracy on direct photographs of physical cards or live phone capture.

The source JPEG SHA-256 is
`7a488a1533d72b0adbc79e45a661801dffd1ba6b85311aa4a0186ec19c6305fc`.
It is 4000 x 3000 with EXIF orientation 6, giving 3000 x 4000 oriented pixels.
The source remains unchanged. Each crop was extracted after applying EXIF
orientation, resized to 900 pixels wide, and saved as JPEG at quality 85. No
perspective correction was applied: the scan test must run the normal detector.

| Fixture | Original oriented crop x,y,width,height | Expected printing |
| --- | --- | --- |
| lonely-poro.jpg | 270,65,1320,1390 | UNL 221/219 |
| daring-poro.jpg | 1480,90,1320,1390 | UNL 225/219 |
| mystic-poro.jpg | 210,1370,1370,1770 | UNL 224/219 |
| veteran-poro.jpg | 1460,1370,1320,1810 | UNL 223/219 |

`backend/test/e2e/riftboundscan.test.js` builds all catalogue embeddings from the
bundled artwork with external HTTP disabled, then uploads these JPEGs to the real
`/api/scan-match` route. It is opt-in because the operator supplies the models:

```sh
CV_MODEL_DIR=/tmp/bindarr-riftbound-models node backend/scripts/fetch-models.mjs
BINDARR_RIFTBOUND_SCAN=1 CV_MODEL_DIR=/tmp/bindarr-riftbound-models node backend/test/e2e/riftboundscan.test.js
```

The test copies the supplied models into temporary state, builds a fresh complete
catalogue and removes it afterwards. It has no runtime dependency on binder-scout.
Lonely and Mystic identify their exact printings above the usual confidence
threshold. Daring yields its exact printing as a manual candidate while the
detector uses its existing whole-frame fallback. Veteran is a difficult glare
frame: a low-confidence unrelated nearest image must be explicitly rejected.
The test preserves those distinctions and does not lower scan confidence gates.
This regression measures only these four screen-photo fixtures, not an aggregate
scanner accuracy claim or accuracy on direct physical-card photos.

Riftbound card text and art are Riot Games property. Bindarr was created under
Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot
Games does not endorse or sponsor this project.
