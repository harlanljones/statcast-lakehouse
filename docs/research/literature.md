# Literature — kinematics & whiff-model grounding

Annotated citations backing the two physics/ML choices in TDD.md. Verified
via arXiv API + Semantic Scholar (2026-09-15); none withdrawn at time of check.

## Physics-based trajectory modeling (the 9-parameter solver)

- **arXiv:physics/0605041** — *The Effect of Spin on the Flight of a Baseball*, A. M. Nathan et al., 2006. Foundational Magnus-force/spin treatment underlying constant-acceleration fits.
- **arXiv:physics/0605040** — *Scattering of a Baseball by a Bat*, R. Cross, A. M. Nathan, 2006. Ball-bat collision physics; exit-velocity/contact modeling context.
- **A Statistical Study of PITCHf/x Pitched Baseball Trajectories**, A. Nathan, 2012 (baseball.physics.illinois.edu; Semantic Scholar: "Analysis of PITCHf/x Pitched Baseball Trajectories"). Directly validates the 9-parameter constant-acceleration fit and its parameter noise/covariance — the core reference for the solver in `web/src/lib/kinematics.ts`.
- **arXiv:0712.0380** — *Influence of a humidor on the aerodynamics of baseballs*, E. Meyer, J. Bohn, 2007. Drag/Magnus sensitivity bounds on trajectory reconstruction.

## Pitch classification / clustering from kinematics

- **arXiv:1304.1756** — *Trouble With the Curve: Improving MLB Pitch Classification*, Pane, Ventura, Steorts, Thomas, 2013. Canonical PITCHf/x clustering; template for pitch-type labels from (ax, ay, az, ...).
- **arXiv:1801.09126** — *Graphic displays of MLB pitching mechanics and its evolutions in PITCHf/x data*, Hsieh, Fujii, Roy, C.-J. Hsieh, 2018. Visualization/evolution of pitch kinematic clusters.
- **arXiv:2006.14411** — *Categorical Exploratory Data Analysis ... baseball pitching dynamics*, Hsieh & Chou, 2020. Multiclass classification + response-manifold view.

## Swing/whiff & plate-discipline prediction (the BQML xWhiff model)

- **arXiv:2507.01238** — *Swinging, Fast and Slow*, S. Powers, R. Yurko, 2025. State-of-the-art Statcast swing-tracking and whiff modeling with kinematics.
- **arXiv:2305.05752** — *Evaluating plate discipline in MLB with Bayesian Additive Regression Trees*, Yee & Deshpande, 2023. Tree-based swing/take probability modeling — methodological sibling of the GBT whiff model.
- **Using PITCHf/x to model the dependence of strikeout rate on pitch mix**, G. Healey, K. Zhao, 2017 (JQAS, via Semantic Scholar). Links kinematics-derived features to outcome rates.

## In-warehouse ML

No peer-reviewed paper specific to BigQuery ML for sports surfaced; closest methods reference is **arXiv:2301.04001** (*Big Ideas in Sports Analytics*, 2023).
