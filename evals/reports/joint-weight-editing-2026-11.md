# Editing Qwen3-4B to detect prompt injection at a fixed threshold

**November 5, 2026.** Could a single weight edit detect at least 95% of attacks while flagging fewer than 5% of benign inputs? Astra met both targets on the 4,078 practice cases. On the 1,066 heldout cases, the frozen detector caught 125 more attacks than the original and produced the same total number of false alarms. That lifted accuracy from 80.96% to 92.68%, but neither target held.

| Measure | Original on practice | Joint edit on practice | Original on heldout | Frozen joint edit on heldout |
| --- | ---: | ---: | ---: | ---: |
| Attack detection (recall) | 2,103/2,712 (77.54%) | 2,627/2,712 (96.87%) | 526/698 (75.36%) | 651/698 (93.27%) |
| False positives among benign inputs | 153/1,366 (11.20%) | 53/1,366 (3.88%) | 31/368 (8.42%) | 31/368 (8.42%) |
| Correct decisions (accuracy) | 3,316/4,078 (81.31%) | 3,940/4,078 (96.62%) | 863/1,066 (80.96%) | 988/1,066 (92.68%) |

## How this differs from the original experiment

Rikiya Takehi, Jayden Teoh, Alex Zhang and Omar Khattab introduced the method in [*Sparks of Weight-Space Programming: LLMs can natively read & write neural network weights*](https://rikiyat.github.io/blog/weight-space-programming/) (MIT CSAIL, November 2, 2026). Their closest comparison is Experiment 8. Astra inspected and edited Qwen3.5-0.8B in Python, using batches of math practice problems and a budget of 10, 25 or 50 forward requests. In the 50-request run, it modified two MLP layers to suppress repetitive generation. MATH-500 accuracy rose from 7.9% to 48.1%. [Authors’ Experiment 8 materials](https://github.com/RikiyaT/lm_understand-logs/tree/main/exp8_math)

We kept their central constraint: Astra chose the edits directly, using tensor algebra and practice feedback without gradient descent. Three differences matter for interpreting the result:

- **Decision.** Their model generated and sampled math answers. Our BF16 Qwen3-4B-Instruct-2507 detector made one forward pass per input. We took the two final-position label logits, normalized them together, and flagged injection when its score exceeded 0.5. The tokenizer, prompt, threshold, embeddings, output head and final normalization stayed fixed.
- **Feedback and budget.** Our harness paired a CPU Python workspace with local MLX inference on an M4 Max. For the joint pass, Astra received both specialist patches and their labeled practice scores. It had 60 additional editor turns, 60 Python actions and unlimited local forward requests. It used 25 turns, 16 Python actions and four forward requests. A request could score an entire panel, so request counts across the two studies measure different amounts of work.
- **Stopping rule.** We required the *same* candidate to detect at least 2,577 of 2,712 practice attacks and flag at most 68 of 1,366 benign inputs. Changing the patch reset its scoring coverage. Only after the complete panels passed and the weights were frozen did the evaluator score heldout inputs against the validated original baseline.

## From two specialists to one edit

The first run optimized accuracy and froze a change to the last MLP. Starting from that checkpoint, one specialist minimized false positives and another maximized detection. Each met its own practice goal, at a substantial cost on the other measure. The joint run began from the same accuracy-first checkpoint in a fresh editor conversation, with both specialists available as references.

| Frozen version | Practice recall | Practice false-positive rate | Heldout recall | Heldout false-positive rate |
| --- | ---: | ---: | ---: | ---: |
| Accuracy-first | 80.27% | 11.20% | 78.08% | 8.42% |
| False-positive specialist | 47.49% | 2.34% | 45.99% | 2.72% |
| Detection specialist | 98.49% | 61.79% | 97.85% | 61.68% |
| Joint edit | 96.87% | 3.88% | 93.27% | 8.42% |

Astra used the midpoint of the specialists’ changes to the attack-versus-benign signal as a starting point. From practice activations at the final MLP, it estimated directions associated with attacks and benign inputs, giving individual examples more influence where either specialist had a small correct-label margin. It used those directions to favor the detection specialist on attack-like activations and the low-false-positive specialist on benign-like activations. It averaged the corrections from three pairs of practice subsets and wrote a single rank-one update relative to the common checkpoint. At inference, every input goes through the same matrix.

The frozen patch replaces only `model.layers.35.mlp.down_proj.weight`. The manifest records 24,722,227 changed BF16 entries in that 2,560 × 9,728 matrix. Rank describes how the update was constructed; even one outer product can change nearly every entry in a matrix. The frozen submission manifest’s SHA-256 was `21b61117e7e042df581ed53238360c66e4cb16e4dbb6f7410b139700b0b757c7`.

## What generalized

The split used ten cohorts spanning web content, code, tables, question answering, email and long documents. Related variants were grouped during splitting, although some attack templates recur across groups. One practice bucket was excluded from the final algebra. On that bucket the joint edit detected 590/632 attacks (93.35%) and flagged 26/333 benign inputs (7.81%). All practice groups had previously been exposed, so this was a diagnostic within practice. It showed the limits of the full-panel result even before validation.

After freezing, the joint edit corrected 145 decisions the original got wrong and lost 20 it got right, a net gain of 125 on heldout. The equal totals of 31 false alarms conceal movement between cohorts. For example, false alarms on BIPIA code fell from four to two, while those on LongPI authorized instructions rose from seven to nine. Missed attacks on BIPIA tables fell from 28 to two. Overall the frozen detector missed 47 attacks. Meeting both heldout targets would have required at least 664 detections and at most 18 false alarms: 13 more detections and 13 fewer false alarms than observed.

Earlier versions had already been evaluated on these same 1,066 cases. Astra received practice evidence only, and validation ran with zero editor calls after the freeze. The paired counts measure the change on this benchmark. Generalization to new attack families or a different mix of benign traffic remains an open question.
