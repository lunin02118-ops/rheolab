// Calibration limits per Chandler 5550 documentation (Section 3 - Maintenance)
// "An acceptable calibration is a STDEV less than 4 dynes per cm² 
//  and Hysteresis of less than 8 dynes per cm²"
export const CALIBRATION_LIMITS = {
    R_SQUARED: 0.999,
    HYSTERESIS: 8.0,  // Max hysteresis per Chandler docs
    STDEV: 4.0,       // Max STDEV per Chandler docs
    SLOPE_MIN: 0.95,
    SLOPE_MAX: 1.05,
    INTERCEPT_MAX: 2.0
};
