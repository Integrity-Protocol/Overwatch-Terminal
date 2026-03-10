# Regional Water Distribution Network (RWDN) Integrity Analysis

## System Overview
The Regional Water Distribution Network (RWDN) is a continuous-pressure hydraulic grid designed to deliver clean water to municipal sectors for domestic use, sanitation, and critical fire flow. The system relies on a central primary pumping station utilizing four high-capacity parallel centrifugal pumps (Pumps 1-4) drawing from Reservoir Alpha. The system is operated by the Municipal Water Authority (MWA) and regulated by the State Public Utility Commission.

## Core Thesis
The RWDN possesses robust structural integrity and sufficient mechanical redundancy to maintain positive system pressure (>40 PSI) and adequate fire flow capabilities across all municipal sectors, even during periods of peak demand or localized equipment maintenance. The system's high reservoir volume guarantees long-term hydraulic stability.

## Key Indicators
* **Pump Load (%):** The operational strain on active pumps. Normal range is 70-85%.
* **Pump Vibration (Hz):** Acoustic/kinetic marker of pump health. Readings above 25 Hz indicate potential cavitation or bearing wear.
* **System Pressure (PSI):** The aggregate pressure in the transmission mains. Must remain above 40 PSI to prevent backflow contamination.
* **Sector Hydrant Pressure (PSI):** Localized pressure. Fire departments require a minimum of 20 PSI residual pressure during active flow.
* **Reservoir Level (%):** The total volume of raw water available for distribution.


## Falsification Criteria (Kill Switches)
The core thesis of system stability is falsified if any of the following structural thresholds are breached:

1. **Redundant Load Threshold:** If the aggregate load on active pumps exceeds 115% of rated capacity for >48 hours, mechanical failure risk is CRITICAL.
2. **Cavitation Threshold:** If sustained pump vibration exceeds 35 Hz while load is >95%, irreversible cavitation damage is ACTIVELY OCCURRING.
3. **Fire Flow Collapse:** If localized Sector Hydrant Pressure falls below 20 PSI, the system has failed its critical life-safety mandate, indicating SEVERE hydraulic degradation.
4. **Regulatory Pressure Breach:** If global system pressure falls below 40 PSI, the system loses sanitary integrity and structural failure is IMMINENT.
5. **Divergent Inventory Paradox:** If Reservoir Level is >90% while System Pressure drops >20% from baseline, the distribution mechanism (pumps/mains) has fundamentally decoupled from supply, indicating CASCADING FAILURE.

## Key Entities
* **Municipal Water Authority (Operators):** Focused on continuity of service and public reassurance. Historically prone to delaying capital-intensive emergency repairs.
* **State Public Utility Commission (Regulators):** Monitors macro-level compliance (e.g., reservoir levels and basic PSI mandates) but lacks real-time telemetry oversight.
* **Regional Fire Dispatch:** A primary end-user of the system's output; their operational adjustments (e.g., calling for water tankers) serve as an independent, high-fidelity indicator of actual system capability.
