# Prompt design: evidence base

This file maps each rule in the learner-facing LLM prompts to the peer-reviewed research behind it. The prompts it covers are:

- the lesson plan (`buildPlanPrompt` + `PLAN_RULES`)
- lesson steps (`buildStepPrompt` + `EXPLANATION_RULES` + `MCQ_RULES`)
- tutor chat (`TUTOR_RULES`)
- practice questions (`buildGenPrompt`)
- free-response grading (`buildGradePrompt`)
- dashboard insights (`INSIGHT_SYSTEM`)
- grounding (`GROUNDING_RULES`)

## Rules and evidence

| Rule | Where | Evidence |
|---|---|---|
| Explicit prerequisites: list 2–4 precise prerequisite concepts, never vague ones like "Basic math". Step 1 opens with a `**Prerequisites:**` line. Every step and tutor prompt receives the list. | plan, step, tutor | Prior knowledge is a strong predictor of post-instruction knowledge, though only a weak predictor of gains [1]. Instruction that fits the learner's existing knowledge outperforms instruction that ignores it [2]. Naming prerequisites lets learners check them before they start. |
| An explicit level definition: what undergrad and grad each assume. | plan, step, tutor | Expertise reversal: guidance that helps novices can hinder more expert learners, so the assumed knowledge must be stated [2]. |
| Steps ordered so that each one uses only the prerequisites and earlier steps, with one idea per step. | plan, step | Segmenting and simple-to-complex sequencing manage intrinsic cognitive load [3][4]. |
| Step summaries as one verb-led statement of what the learner can do. Vague verbs such as "understand" and "explore" are banned. | plan | Clear, specific goals ("where am I going?") are a precondition for effective feedback and learning [5]. |
| Bold each new term and define it in plain words. State rules exactly, with their conditions. No filler or hedges. | step, tutor, gen | Signaling key terms improves retention and transfer [6]. Removing extraneous words (the coherence principle) lowers extraneous load [3]. Novices learn more from explicit, fully guided explanation than from minimal guidance [7]. |
| A concrete case alongside the general statement. | step | Concreteness fading: concrete grounding followed by abstraction improves STEM transfer [8]. |
| A worked example with each step and its reason, using new numbers. | step | Worked examples with explained steps beat unsupported problem solving for novices [4][9]. |
| The check asks the learner to apply the idea to a new case, not to recall a phrase. | step, gen | Retrieval practice improves long-term retention [10][11]. Generative, constructive activity yields deeper learning than passive recall [12]. |
| MCQ items: a complete stem, one best answer, choices of similar length, no "All/None of the above", no negatively worded stems. | step, gen | These are consensus item-writing guidelines [13]. |
| Wrong choices built from specific common mistakes. The explanation names each mistake. | step, gen | Misconception-based distractors give diagnostic information and better items [14]. |
| A free-response stem that states the expected length and scope. Rubric criteria name exact facts, steps or results. | gen, grade | Specific criteria make clear what success looks like [5]. Specific, elaborated feedback beats vague feedback [15]. |
| Grading feedback in a fixed order: what was right, what was wrong with the correct version, then one next step. No vague praise. | grade | Feedback works when it answers "how am I going" and "where to next" at the task level. Praise without task information has little effect [5][15]. |
| The tutor answers the learner's actual question, gives step-level minimal hints, and gives full solutions on request. | tutor | Step-level tutoring approaches the effectiveness of human tutors [16]. Novices need direct guidance when they ask for it [7]. |
| The tutor restates the misconception, says plainly that it is wrong, explains why, then states the correct idea. | tutor | Refutation texts produce conceptual change more reliably than plain exposition [17]. |
| The tutor ends with an explain, predict or apply question, never "Does that make sense?". | tutor | Prompted self-explanation reliably improves learning [18][19]. |
| Insights use actual numbers, plain-language metric names, and one concrete action when a trend is unfavourable. | insights | Feedback should be specific and point to a next step [5]. Calibration feedback helps correct overconfidence, which undermines learning [20]. |
| A citation only when the source states the claim. No "from general knowledge" boilerplate. | grounding | Extraneous text that adds no meaning increases load (coherence) [3]. The no-fabrication rule is unchanged. |

## References

1. Simonsmeier, B. A., Flaig, M., Deiglmayr, A., Schalk, L., & Schneider, M. (2022). Domain-specific prior knowledge and learning: A meta-analysis. *Educational Psychologist, 57*(1), 31–54. https://doi.org/10.1080/00461520.2021.1939700
2. Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist, 38*(1), 23–31. https://doi.org/10.1207/S15326985EP3801_4
3. Mayer, R. E., & Moreno, R. (2003). Nine ways to reduce cognitive load in multimedia learning. *Educational Psychologist, 38*(1), 43–52. https://doi.org/10.1207/S15326985EP3801_6
4. Sweller, J., van Merriënboer, J. J. G., & Paas, F. (2019). Cognitive architecture and instructional design: 20 years later. *Educational Psychology Review, 31*, 261–292. https://doi.org/10.1007/s10648-019-09465-5
5. Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of Educational Research, 77*(1), 81–112. https://doi.org/10.3102/003465430298487
6. Schneider, S., Beege, M., Nebel, S., & Rey, G. D. (2018). A meta-analysis of how signaling affects learning with media. *Educational Research Review, 23*, 1–24. https://doi.org/10.1016/j.edurev.2017.11.001
7. Kirschner, P. A., Sweller, J., & Clark, R. E. (2006). Why minimal guidance during instruction does not work. *Educational Psychologist, 41*(2), 75–86. https://doi.org/10.1207/s15326985ep4102_1
8. Fyfe, E. R., McNeil, N. M., Son, J. Y., & Goldstone, R. L. (2014). Concreteness fading in mathematics and science instruction: A systematic review. *Educational Psychology Review, 26*(1), 9–25. https://doi.org/10.1007/s10648-014-9249-3
9. Renkl, A. (2014). Toward an instructionally oriented theory of example-based learning. *Cognitive Science, 38*(1), 1–37. https://doi.org/10.1111/cogs.12086
10. Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science, 17*(3), 249–255. https://doi.org/10.1111/j.1467-9280.2006.01693.x
11. Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest, 14*(1), 4–58. https://doi.org/10.1177/1529100612453266
12. Chi, M. T. H., & Wylie, R. (2014). The ICAP framework: Linking cognitive engagement to active learning outcomes. *Educational Psychologist, 49*(4), 219–243. https://doi.org/10.1080/00461520.2014.965823
13. Haladyna, T. M., Downing, S. M., & Rodriguez, M. C. (2002). A review of multiple-choice item-writing guidelines for classroom assessment. *Applied Measurement in Education, 15*(3), 309–333. https://doi.org/10.1207/S15324818AME1503_5
14. Gierl, M. J., Bulut, O., Guo, Q., & Zhang, X. (2017). Developing, analyzing, and using distractors for multiple-choice tests in education: A comprehensive review. *Review of Educational Research, 87*(6), 1082–1116. https://doi.org/10.3102/0034654317726529
15. Shute, V. J. (2008). Focus on formative feedback. *Review of Educational Research, 78*(1), 153–189. https://doi.org/10.3102/0034654307313795
16. VanLehn, K. (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems. *Educational Psychologist, 46*(4), 197–221. https://doi.org/10.1080/00461520.2011.611369
17. Tippett, C. D. (2010). Refutation text in science education: A review of two decades of research. *International Journal of Science and Mathematics Education, 8*(6), 951–970. https://doi.org/10.1007/s10763-010-9203-x
18. Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C. (1994). Eliciting self-explanations improves understanding. *Cognitive Science, 18*(3), 439–477. https://doi.org/10.1207/s15516709cog1803_3
19. Bisra, K., Liu, Q., Nesbit, J. C., Salimi, F., & Winne, P. H. (2018). Inducing self-explanation: A meta-analysis. *Educational Psychology Review, 30*(3), 703–725. https://doi.org/10.1007/s10648-018-9434-x
20. Dunlosky, J., & Rawson, K. A. (2012). Overconfidence produces underachievement: Inaccurate self evaluations undermine students' learning and retention. *Learning and Instruction, 22*(4), 271–280. https://doi.org/10.1016/j.learninstruc.2011.08.003
