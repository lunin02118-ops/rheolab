/**
 * Test xlsx-chart line chart for time series data
 */
const fs = require('fs');
const path = require('path');
const XLSXChart = require('xlsx-chart');
const xlsxChart = new XLSXChart();

// Преобразуем временные ряды в формат xlsx-chart
// Для line chart: titles = серии данных, fields = точки по X
const rawData = [
    { time_sec: 0, viscosity_cp: 50, temperature_c: 25 },
    { time_sec: 60, viscosity_cp: 100, temperature_c: 30 },
    { time_sec: 120, viscosity_cp: 200, temperature_c: 40 },
    { time_sec: 180, viscosity_cp: 350, temperature_c: 50 },
    { time_sec: 240, viscosity_cp: 450, temperature_c: 60 },
    { time_sec: 300, viscosity_cp: 500, temperature_c: 65 },
];

// Формат xlsx-chart: 
// titles - это серии данных (Viscosity, Temperature)
// fields - это точки на X-оси (время)
const fields = rawData.map(p => `${(p.time_sec / 60).toFixed(1)} мин`);
const data = {
    'Вязкость (cP)': {},
    'Температура (°C)': {}
};

rawData.forEach((p, i) => {
    const label = fields[i];
    data['Вязкость (cP)'][label] = p.viscosity_cp;
    data['Температура (°C)'][label] = p.temperature_c;
});

const opts = {
    chart: 'line',
    titles: ['Вязкость (cP)', 'Температура (°C)'],
    fields: fields,
    data: data,
    chartTitle: 'Реология: Вязкость vs Время'
};

console.log('Generating line chart...');
console.log('Opts:', JSON.stringify(opts, null, 2));

xlsxChart.generate(opts, (err, buffer) => {
    if (err) {
        console.error('Error:', err);
        return;
    }

    const outputPath = path.join(__dirname, '..', 'test-output', 'line-chart-test.xlsx');
    fs.writeFileSync(outputPath, buffer);
    console.log('SUCCESS:', outputPath, '- Size:', buffer.length, 'bytes');
});
