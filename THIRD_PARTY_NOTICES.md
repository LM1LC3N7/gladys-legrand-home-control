# Third-party notices

This integration is licensed under Apache-2.0 (see `LICENSE`). It ports to
JavaScript parts of the approach of the following project; no code is copied
verbatim, but the module types, the state fields and the shutter values below
follow it.

## pyatmo

- Project: https://github.com/jabesq-org/pyatmo
- Used for: the list of the Legrand Home + Control and Bubendorff iDiamant
  module types (NLG, NLP, NLV, NLLV... and NBG gateway, NBR roller shutter,
  NBO orientable shutter, NBS swing shutter), the `battery_state` levels, the
  shutter fields (`current_position`, `target_position`,
  `target_position:step` or `target_position_step`), the setstate shutter
  values (100 open, 0 close, -1 stop, -2 favourite position) and the reading
  of a step of 100 as "open, close and stop only".
- License: MIT

```
MIT License

Copyright (c) 2018 Hugo DUPRAS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
