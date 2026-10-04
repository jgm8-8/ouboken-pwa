# OCR model

`ch_PP-OCRv4_rec_infer.onnx` is the PP-OCRv4 recognition model distributed in
`rapidocr-onnxruntime==1.4.4` (Apache-2.0), from https://github.com/RapidAI/RapidOCR.
Original model architecture/training: https://github.com/PaddlePaddle/PaddleOCR.
Copyright (c) 2020 PaddlePaddle Authors. All Rights Reserved.
RapidOCR engineering components: Copyright RapidOCR Authors.
See LICENSE for the Apache License, Version 2.0.

`characters.json` is the character list embedded in that ONNX model, with a CTC
blank prepended and the space token appended, as in RapidOCR's CTCLabelDecode.
The browser implementation adapts the normalization and CTC decoding described
in RapidOCR's Apache-2.0 recognition code. The detector and classifier models
are not used. These files contain publicly distributed model data, no user
photos, serial codes, addresses, or answers.
