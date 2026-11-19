import os
from pathlib import Path

csv_dir = Path(r"c:\Users\Neil Shinde\Desktop\BELIMO\Project(s)\Knowledge Graph and Reasoning\Collia\data\csv")
csv_dir.mkdir(parents=True, exist_ok=True)

# Generate 24 hourly timestamps for 2024-11-01
timestamps = [f"2024-11-01 {h:02d}:00:00" for h in range(24)]

files_data = {}

# 1. RAQS 101, 102, 103: Timestamp,Temperature,Humidity,CO2
for zone, (t_base, h_base, co2_base) in [("101", (22.0, 50.0, 450)), ("102", (23.5, 55.0, 600)), ("103", (21.5, 48.0, 420))]:
    lines = ["Timestamp,Temperature,Humidity,CO2"]
    for i, ts in enumerate(timestamps):
        # Daytime increase in temp & CO2
        occ = 1.0 if 8 <= i <= 18 else 0.2
        temp = round(t_base + occ * 1.5 + (i % 3) * 0.2, 1)
        hum = round(h_base + (i % 4) * 1.0 - occ * 2.0, 1)
        co2 = int(co2_base + occ * 350 + (i % 5) * 15)
        lines.append(f"{ts},{temp},{hum},{co2}")
    files_data[f"RAQS_{zone}.csv"] = "\n".join(lines) + "\n"

# 2. VAV 101, 102, 103: Timestamp,Airflow,Temperature,Pressure
for zone, (af_base, t_base, p_base) in [("101", (180.0, 21.0, 45.0)), ("102", (320.0, 22.0, 65.0)), ("103", (140.0, 20.5, 40.0))]:
    lines = ["Timestamp,Airflow,Temperature,Pressure"]
    for i, ts in enumerate(timestamps):
        occ = 1.0 if 8 <= i <= 18 else 0.3
        af = round(af_base * occ + (i % 4) * 8.0, 1)
        temp = round(t_base + (i % 3) * 0.3, 1)
        p = round(p_base * occ + (i % 5) * 2.5, 1)
        lines.append(f"{ts},{af},{temp},{p}")
    files_data[f"VAV_{zone}.csv"] = "\n".join(lines) + "\n"

# 3. EV 01: Timestamp,Actuator_Position,Flow_Rate,T1,T2,Tonnage,Control_Signal
lines_ev = ["Timestamp,Actuator_Position,Flow_Rate,T1,T2,Tonnage,Control_Signal"]
for i, ts in enumerate(timestamps):
    occ = 1.0 if 8 <= i <= 18 else 0.15
    act = round(occ * 75.0 + (i % 5) * 2.0, 1)
    flow = round(occ * 45.0 + (i % 4) * 1.5, 1)
    t1 = round(7.0 + (i % 3) * 0.2, 1)
    t2 = round(13.2 + occ * 1.5, 1)
    ton = round(flow * (t2 - t1) * 0.25, 2)
    sig = round(act / 10.0, 2)
    lines_ev.append(f"{ts},{act},{flow},{t1},{t2},{ton},{sig}")
files_data["EV_01.csv"] = "\n".join(lines_ev) + "\n"

# 4. AHU 01: Timestamp,Fan_Speed,Airflow,Flow_Rate,T1,T2,Tonnage,Return_Air_Temp,Supply_Air_Temp,Filter_Status,Heat_Recovery_Wheel_Status
lines_ahu = ["Timestamp,Fan_Speed,Airflow,Flow_Rate,T1,T2,Tonnage,Return_Air_Temp,Supply_Air_Temp,Filter_Status,Heat_Recovery_Wheel_Status"]
for i, ts in enumerate(timestamps):
    occ = 1.0 if 8 <= i <= 18 else 0.25
    rpm = int(occ * 1250 + (i % 4) * 30)
    af = round(occ * 2200.0 + (i % 5) * 40.0, 1)
    flow = round(occ * 45.0 + (i % 3) * 2.0, 1)
    t1 = round(7.0 + (i % 3) * 0.2, 1)
    t2 = round(13.5 + occ * 1.2, 1)
    ton = round(flow * (t2 - t1) * 0.25, 2)
    rat = round(24.0 + occ * 1.5, 1)
    sat = round(15.5 - occ * 1.0, 1)
    filt = 0
    hrw = 1 if 8 <= i <= 18 else 0
    lines_ahu.append(f"{ts},{rpm},{af},{flow},{t1},{t2},{ton},{rat},{sat},{filt},{hrw}")
files_data["AHU_01.csv"] = "\n".join(lines_ahu) + "\n"

# 5. Chiller 01: Timestamp,Operating_Status,Compressor_Speed,CHW_Supply_Temp,CHW_Supply_Pressure,CHW_Supply_Flow,CHW_Return_Temp,CHW_Return_Pressure,CHW_Return_Flow
lines_ch = ["Timestamp,Operating_Status,Compressor_Speed,CHW_Supply_Temp,CHW_Supply_Pressure,CHW_Supply_Flow,CHW_Return_Temp,CHW_Return_Pressure,CHW_Return_Flow"]
for i, ts in enumerate(timestamps):
    op = 1 if 7 <= i <= 19 else 0
    spd = round(op * 78.0 + (i % 4) * 2.5, 1)
    sup_t = round(6.8 + (i % 3) * 0.1, 1) if op else 15.0
    sup_p = round(2.8 + (i % 3) * 0.1, 2) if op else 1.0
    sup_f = round(op * 350.0 + (i % 5) * 10.0, 1)
    ret_t = round(12.5 + op * 1.5, 1) if op else 15.2
    ret_p = round(sup_p - 0.6, 2)
    ret_f = sup_f
    lines_ch.append(f"{ts},{op},{spd},{sup_t},{sup_p},{sup_f},{ret_t},{ret_p},{ret_f}")
files_data["Chiller_01.csv"] = "\n".join(lines_ch) + "\n"

# Write out all files
for fname, content in files_data.items():
    p = csv_dir / fname
    p.write_text(content, encoding="utf-8")
    print(f"Wrote {fname} ({len(content)} bytes)")
