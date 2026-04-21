/**
 * Unit-aware chart label translations (ru / en).
 *
 * Returned object is a plain data bag — no functions closed over component state.
 * Used by both axis builders and tooltip plugins.
 */
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { PressureUnit, TimeDisplayFormat } from '@/lib/store/chart-settings-types';
import { formatTimeTick, pressureLabel, timeAxisUnit } from './time-format';

export interface ChartTranslations {
    timeAxis: string;
    viscosityAxis: string;
    temperatureAxis: string;
    bathTempAxis: string;
    tempBathCombinedAxis: string;
    shearRateAxis: string;
    pressureAxis: string;
    rpmAxis: string;
    seriesTime: string;
    seriesViscosity: string;
    seriesTemperature: string;
    seriesShearRate: string;
    seriesPressure: string;
    seriesRpm: string;
    seriesBathTemp: string;
    tooltipUnits: string[];
    tooltipTimeLabel: (v: number) => string;
}

export interface BuildTranslationsParams {
    activeSettings: ChartSettings;
    chartSettings: ChartSettings;
    language: 'ru' | 'en';
}

/**
 * Build unit-aware localised chart labels for the given settings + language.
 */
export function buildChartTranslations({
    activeSettings,
    chartSettings,
    language,
}: BuildTranslationsParams): ChartTranslations {
    const uVisc = activeSettings.lines.viscosity.unit ?? 'mPa·s';
    const uTemp = activeSettings.lines.temperature.unit ?? '°C';
    const uBath = activeSettings.lines.bathTemperature?.unit ?? uTemp;
    const uShear = activeSettings.lines.shearRate.unit ?? '1/s';
    const uPress = activeSettings.lines.pressure.unit ?? 'bar';
    const uRpm = activeSettings.lines.rpm.unit ?? 'RPM';
    const timeFmt: TimeDisplayFormat = chartSettings.rheologyUnits?.timeFormat ?? 'seconds';

    if (language === 'en') {
        return {
            timeAxis: `Time (${timeAxisUnit(timeFmt, 'en')})`,
            viscosityAxis: `Viscosity (${uVisc})`,
            temperatureAxis: `Temperature (${uTemp})`,
            bathTempAxis: `Bath Temp. (${uBath})`,
            tempBathCombinedAxis: `Temp. / Bath Temp. (${uTemp})`,
            shearRateAxis: `Shear Rate (${uShear})`,
            pressureAxis: `Pressure (${uPress})`,
            rpmAxis: uRpm,
            seriesTime: 'Time',
            seriesViscosity: 'Viscosity',
            seriesTemperature: 'Temperature',
            seriesShearRate: 'Shear Rate',
            seriesPressure: 'Pressure',
            seriesRpm: 'RPM',
            seriesBathTemp: 'Bath Temp.',
            tooltipUnits: ['', uVisc, uTemp, uShear, uPress, uRpm, uBath],
            tooltipTimeLabel: (v: number) => `Time: ${formatTimeTick(v, timeFmt)} ${timeAxisUnit(timeFmt, 'en')}`,
        };
    }

    return {
        timeAxis: `Время (${timeAxisUnit(timeFmt, 'ru')})`,
        viscosityAxis: `Вязкость (${uVisc === 'cP' ? 'сП' : uVisc})`,
        temperatureAxis: `Температура (${uTemp})`,
        bathTempAxis: `Темп. бани (${uBath})`,
        tempBathCombinedAxis: `Температура / Темп. бани (${uTemp})`,
        shearRateAxis: `Скор. сдвига (${uShear === '1/s' ? '1/с' : uShear})`,
        pressureAxis: `Давление (${pressureLabel(uPress as PressureUnit, 'ru')})`,
        rpmAxis: `Обороты (${uRpm === 'RPM' ? 'об/мин' : uRpm})`,
        seriesTime: 'Время',
        seriesViscosity: 'Вязкость',
        seriesTemperature: 'Температура',
        seriesShearRate: 'Скор. сдвига',
        seriesPressure: 'Давление',
        seriesRpm: 'Обороты',
        seriesBathTemp: 'Темп. бани',
        tooltipUnits: [
            '',
            uVisc === 'cP' ? 'сП' : uVisc,
            uTemp,
            uShear === '1/s' ? '1/с' : uShear,
            pressureLabel(uPress as PressureUnit, 'ru'),
            uRpm === 'RPM' ? 'об/мин' : uRpm,
            uBath,
        ],
        tooltipTimeLabel: (v: number) => `Время: ${formatTimeTick(v, timeFmt)} ${timeAxisUnit(timeFmt, 'ru')}`,
    };
}
