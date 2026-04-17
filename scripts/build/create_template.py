
import sys
import xlsxwriter
import os

def create_template(output_path):
    # Ensure directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    workbook = xlsxwriter.Workbook(output_path)
    worksheet = workbook.add_worksheet('Report')
    
    # Formats
    header_format = workbook.add_format({'bold': True, 'bg_color': '#f1f5f9', 'border': 1, 'align': 'center', 'valign': 'vcenter', 'text_wrap': True})
    cell_format = workbook.add_format({'border': 1, 'align': 'left', 'valign': 'vcenter', 'text_wrap': True})
    number_format = workbook.add_format({'num_format': '0.00', 'border': 1, 'align': 'center', 'valign': 'vcenter'})
    section_title_format = workbook.add_format({'bold': True, 'font_size': 11, 'color': '#1e293b', 'bottom': 1})

    # Print Settings
    worksheet.set_paper(9) # A4
    worksheet.set_portrait()
    worksheet.fit_to_pages(1, 0)
    worksheet.set_margins(0.5, 0.5, 0.5, 0.5)

    # Set column widths (Fixed to match original script)
    worksheet.set_column(0, 0, 15) # A
    worksheet.set_column(1, 1, 20) # B
    worksheet.set_column(2, 9, 12) # C-J

    # --- 1. Setup Dynamic Titles Area (Hidden Z column) ---
    worksheet.write('Z1', 'Вязкость vs Время')
    worksheet.write('Z2', 'Время (мин)')
    worksheet.write('Z3', 'Вязкость (сП)')
    worksheet.write('Z4', 'Температура / Скорость сдвига / Давление')

    # --- 2. Setup Data Headers (Hidden U-Y columns) ---
    headers = ['Time', 'Viscosity', 'Temperature', 'ShearRate', 'Pressure']
    for i, h in enumerate(headers):
        worksheet.write(0, 20 + i, h)

    # Add some dummy data to ensure chart renders correctly in template
    dummy_data = [
        [0, 100, 25, 100, 0],
        [10, 90, 30, 100, 10]
    ]
    for row_idx, row_data in enumerate(dummy_data):
        for col_idx, val in enumerate(row_data):
            worksheet.write(row_idx + 1, 20 + col_idx, val)

    # --- 3. Define Named Ranges ---
    workbook.define_name('TimeData', '=OFFSET(Report!$U$2, 0, 0, COUNT(Report!$U:$U), 1)')
    workbook.define_name('ViscosityData', '=OFFSET(Report!$V$2, 0, 0, COUNT(Report!$V:$V), 1)')
    workbook.define_name('TemperatureData', '=OFFSET(Report!$W$2, 0, 0, COUNT(Report!$W:$W), 1)')
    workbook.define_name('ShearRateData', '=OFFSET(Report!$X$2, 0, 0, COUNT(Report!$X:$X), 1)')
    workbook.define_name('PressureData', '=OFFSET(Report!$Y$2, 0, 0, COUNT(Report!$Y:$Y), 1)')

    # --- 4. Create Chart ---
    chart = workbook.add_chart({'type': 'scatter', 'subtype': 'smooth'})

    # Series 1: Viscosity (Blue)
    chart.add_series({
        'name': 'Вязкость',
        'categories': '=Report!TimeData',
        'values':     '=Report!ViscosityData',
        'line':       {'color': '#3b82f6', 'width': 1.5},
        'marker':     {'type': 'circle', 'size': 5, 'fill': {'color': '#3b82f6'}}
    })

    # Series 2: Temperature (Red, Dashed, Y2)
    chart.add_series({
        'name': 'Температура',
        'categories': '=Report!TimeData',
        'values':     '=Report!TemperatureData',
        'y2_axis':    True,
        'line':       {'color': '#ef4444', 'width': 1.5, 'dash_type': 'dash'},
        'marker':     {'type': 'none'}
    })

    # Series 3: Shear Rate (Purple, Y2)
    chart.add_series({
        'name': 'Скорость сдвига',
        'categories': '=Report!TimeData',
        'values':     '=Report!ShearRateData',
        'y2_axis':    True,
        'line':       {'color': '#a855f7', 'width': 1.5},
        'marker':     {'type': 'none'}
    })

    # Series 4: Pressure (Green, Dotted, Y2)
    chart.add_series({
        'name': 'Давление',
        'categories': '=Report!TimeData',
        'values':     '=Report!PressureData',
        'y2_axis':    True,
        'line':       {'color': '#22c55e', 'width': 1.5, 'dash_type': 'dot'},
        'marker':     {'type': 'none'}
    })

    # Chart Configuration
    chart.set_title({'name': '=Report!$Z$1'})
    
    chart.set_x_axis({
        'name': '=Report!$Z$2',
        'major_gridlines': {'visible': True},
        'min': 0,
        'num_format': '0'
    })
    
    chart.set_y_axis({
        'name': '=Report!$Z$3',
        'major_gridlines': {'visible': True},
        'num_format': '0'
    })
    
    chart.set_y2_axis({
        'name': '=Report!$Z$4',
        'major_gridlines': {'visible': False}
    })

    chart.set_size({'width': 967, 'height': 500})
    
    # Insert chart at A1
    worksheet.insert_chart('A1', chart)

    # --- 5. Add Placeholders for other sections ---
    # Summary Title - Start at row 27 (index 26) to avoid chart overlap
    worksheet.write(26, 0, "Сводка", section_title_format)
    # Recipe Title
    worksheet.write(26, 4, "Рецептура", section_title_format)

    workbook.close()
    print(f"Template created at: {output_path}")

if __name__ == "__main__":
    output_file = "src/assets/report-template.xlsx"
    if len(sys.argv) > 1:
        output_file = sys.argv[1]
    create_template(output_file)
