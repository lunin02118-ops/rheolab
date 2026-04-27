//! Test suite for the experiments list-query module.
//!
//! Split into focused submodules so each section stays under ~500 LOC:
//!
//! | File                    | Coverage                                     |
//! |-------------------------|----------------------------------------------|
//! | `fixtures.rs`           | Shared `pub(super)` test helpers             |
//! | `basic.rs`              | CRUD + pagination + simple filters           |
//! | `touch_point_filter.rs` | Touch-point filter behaviours (PR2 Phase C)  |
//! | `touch_point_stats.rs`  | Library-wide stats snapshot                  |
//! | `dynamic_threshold.rs`  | User-configurable viscosity threshold        |
//! | `regression.rs`         | Production-bug regressions (small fixtures)  |
//! | `combat_thresholds.rs`  | Combat: ALL fixtures × ALL preset thresholds |
//! | `combat_composite.rs`   | Combat: composite threshold + time-window    |

use super::*;

mod fixtures;

mod basic;
mod combat_composite;
mod combat_thresholds;
mod dynamic_threshold;
mod regression;
mod touch_point_filter;
mod touch_point_stats;
