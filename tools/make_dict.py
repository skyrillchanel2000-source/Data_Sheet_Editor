"""Собирает dict.js — офлайн-словарь RU→EN для автоперевода.

Источник пар: эталонный seed.json (там уже есть готовые RU/EN пары во всех
листах) + ручной глоссарий EXTRA для терминов, которых в эталоне нет.
Запуск: python tools/make_dict.py
"""
import json
import re
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / "dict.js"

CYR = re.compile(r"[А-Яа-яЁё]")

EXTRA = {
    # типовые параметры и заголовки таблиц
    "Наименование": "Name",
    "Обозначение": "Designation",
    "Маркировка": "Marking",
    "Примечание": "Note",
    "Примечания": "Notes",
    "Единица измерения": "Unit of measurement",
    "Значение": "Value",
    "Параметр": "Parameter",
    "Характеристика": "Characteristic",
    "Технические характеристики": "Technical characteristics",
    "Технические данные": "Technical data",
    "Основные технические характеристики": "Main technical characteristics",
    "Дополнительные характеристики": "Additional characteristics",
    "Комплект поставки": "Scope of delivery",
    "Комплектация": "Complete set",
    "Исполнение": "Version",
    "Исполнения": "Versions",
    "Тип исполнения": "Version type",
    "Номинальный": "Nominal",
    "Номинальная": "Nominal",
    "Номинальное": "Nominal",
    "Максимальный": "Maximum",
    "Минимальный": "Minimum",
    "Рабочий": "Operating",
    "Рабочая": "Operating",
    "Рабочее": "Operating",
    "Рабочие": "Operating",
    "Диапазон": "Range",
    "Верхний предел": "Upper limit",
    "Нижний предел": "Lower limit",
    "Предел": "Limit",
    "Погрешность": "Accuracy",
    "Предел допускаемой погрешности": "Limit of permissible error",
    "Приведённая погрешность": "Reference accuracy",
    "Класс точности": "Accuracy class",
    "Гистерезис": "Hysteresis",
    "Воспроизводимость": "Repeatability",
    "Стабильность": "Stability",
    "Разрешение": "Resolution",
    "Выходной сигнал": "Output signal",
    "Входной сигнал": "Input signal",
    "Питание": "Power supply",
    "Напряжение питания": "Supply voltage",
    "Потребляемая мощность": "Power consumption",
    "Электрическое подключение": "Electrical connection",
    "Электрический разъём": "Electrical connector",
    "Кабельный ввод": "Cable entry",
    "Клеммная колодка": "Terminal block",
    "Заземление": "Grounding",
    "Взрывозащита": "Explosion protection",
    "Маркировка взрывозащиты": "Explosion protection marking",
    "Степень защиты": "Degree of protection",
    "Степень пылевлагозащиты": "Degree of dust and moisture protection",
    "Температура окружающей среды": "Ambient temperature",
    "Температура окружающего воздуха": "Ambient air temperature",
    "Температура эксплуатации": "Operating temperature",
    "Температура хранения": "Storage temperature",
    "Температура измеряемой среды": "Temperature of the measured medium",
    "Относительная влажность": "Relative humidity",
    "Влажность": "Humidity",
    "Давление": "Pressure",
    "Избыточное давление": "Overpressure",
    "Рабочее давление": "Working pressure",
    "Абсолютное давление": "Absolute pressure",
    "Разность давлений": "Differential pressure",
    "Перепад давления": "Pressure drop",
    "Испытательное давление": "Test pressure",
    "Максимальное давление": "Maximum pressure",
    "Давление разрыва": "Burst pressure",
    "Разрежение": "Vacuum",
    "Расход": "Flow rate",
    "Уровень": "Level",
    "Уровень жидкости": "Liquid level",
    "Уровень заполнения": "Filling level",
    "Объём": "Volume",
    "Масса": "Weight",
    "Длина": "Length",
    "Ширина": "Width",
    "Высота": "Height",
    "Глубина": "Depth",
    "Толщина": "Thickness",
    "Диаметр": "Diameter",
    "Наружный диаметр": "Outer diameter",
    "Внутренний диаметр": "Inner diameter",
    "Габаритные размеры": "Overall dimensions",
    "Присоединение": "Connection",
    "Присоединение к процессу": "Process connection",
    "Присоединение к прибору": "Connection to the device",
    "Резьба": "Thread",
    "Резьбовое соединение": "Threaded connection",
    "Фланец": "Flange",
    "Фланцевое присоединение": "Flanged connection",
    "Штуцер": "Fitting",
    "Ниппель": "Nipple",
    "Муфта": "Coupling",
    "Переходник": "Adapter",
    "Заглушка": "Plug",
    "Уплотнение": "Seal",
    "Уплотнительное кольцо": "O-ring",
    "Материал": "Material",
    "Материал корпуса": "Housing material",
    "Материал мембраны": "Diaphragm material",
    "Материал уплотнения": "Seal material",
    "Материал присоединения": "Connection material",
    "Материал кабельного ввода": "Cable entry material",
    "Корпус": "Housing",
    "Крышка": "Cover",
    "Мембрана": "Diaphragm",
    "Измерительная мембрана": "Measuring diaphragm",
    "Камера": "Chamber",
    "Камерная полость": "Chamber cavity",
    "Полость": "Cavity",
    "Заполняющая жидкость": "Fill fluid",
    "Жидкость": "Liquid",
    "Силиконовое масло": "Silicone oil",
    "Масло": "Oil",
    "Сталь": "Steel",
    "Нержавеющая сталь": "Stainless steel",
    "Алюминий": "Aluminium",
    "Латунь": "Brass",
    "Медь": "Copper",
    "Титан": "Titanium",
    "Хастеллой": "Hastelloy",
    "Фторопласт": "PTFE",
    "Полиамид": "Polyamide",
    "Резина": "Rubber",
    "Датчик": "Sensor",
    "Датчик давления": "Pressure sensor",
    "Датчик температуры": "Temperature sensor",
    "Датчик уровня": "Level sensor",
    "Датчик разности давлений": "Differential pressure transmitter",
    "Преобразователь": "Transmitter",
    "Преобразователь давления": "Pressure transmitter",
    "Измерительный преобразователь": "Measuring transmitter",
    "Манометр": "Pressure gauge",
    "Термометр": "Thermometer",
    "Термопреобразователь": "Temperature sensor",
    "Термопара": "Thermocouple",
    "Термосопротивление": "Resistance thermometer",
    "Расходомер": "Flow meter",
    "Уровнемер": "Level meter",
    "Сигнализатор": "Switch",
    "Сигнализатор уровня": "Level switch",
    "Индикатор": "Indicator",
    "Дисплей": "Display",
    "Экран": "Screen",
    "Клавиатура": "Keypad",
    "Кнопка": "Button",
    "Реле": "Relay",
    "Предохранитель": "Fuse",
    "Кабель": "Cable",
    "Провод": "Wire",
    "Гильза": "Protective sleeve",
    "Защитная гильза": "Thermowell",
    "Манифольд": "Manifold",
    "Вентильный блок": "Manifold valve",
    "Клапан": "Valve",
    "Кран": "Valve",
    "Вентиль": "Valve",
    "Задвижка": "Gate valve",
    "Труба": "Pipe",
    "Трубка": "Tube",
    "Бак": "Tank",
    "Резервуар": "Reservoir",
    "Ёмкость": "Vessel",
    "Фильтр": "Filter",
    "Насос": "Pump",
    "Компрессор": "Compressor",
    "Производитель": "Manufacturer",
    "Изготовитель": "Manufacturer",
    "Поставщик": "Supplier",
    "Страна происхождения": "Country of origin",
    "Страна изготовления": "Country of manufacture",
    "Гарантийный срок": "Warranty period",
    "Гарантия": "Warranty",
    "Срок службы": "Service life",
    "Ресурс": "Service life",
    "Наработка": "Operating time",
    "Межповерочный интервал": "Calibration interval",
    "Поверка": "Calibration",
    "Межповерочный": "Calibration",
    "Сертификат": "Certificate",
    "Сертификат соответствия": "Certificate of conformity",
    "Декларация": "Declaration",
    "Разрешение": "Permit",
    "Лицензия": "License",
    "Паспорт": "Data sheet",
    "Руководство": "Manual",
    "Руководство по эксплуатации": "Operation manual",
    "Документация": "Documentation",
    "Схема": "Diagram",
    "Схема подключения": "Wiring diagram",
    "Чертёж": "Drawing",
    "Габаритный чертёж": "Dimensional drawing",
    "Рисунок": "Figure",
    "Таблица": "Table",
    "Фотография": "Photo",
    "Внешний вид": "Appearance",
    "Устройство": "Design",
    "Принцип действия": "Operating principle",
    "Назначение": "Purpose",
    "Область применения": "Application area",
    "Применение": "Application",
    "Условия эксплуатации": "Operating conditions",
    "Условия окружающей среды": "Environmental conditions",
    "Монтаж": "Installation",
    "Установка": "Installation",
    "Эксплуатация": "Operation",
    "Обслуживание": "Maintenance",
    "Хранение": "Storage",
    "Транспортировка": "Transportation",
    "Проект": "Project",
    "Проектная документация": "Design documentation",
    "Заказ": "Order",
    "Заказчик": "Customer",
    "Позиция": "Item",
    "Номер": "Number",
    "Номер прибора": "Device number",
    "Лист": "Sheet",
    "Лист прибора": "Device sheet",
    "Страница": "Page",
    "Наименование прибора": "Device name",
    "Название прибора": "Device name",
    "Название проекта": "Project name",
    "Комплект": "Kit",
    "Стандарт": "Standard",
    "Соответствие": "Compliance",
    "Соответствует": "Complies with",
    "Не применимо": "Not applicable",
    "По требованию": "At the request",
    "По заказу": "On request",
    "Опция": "Option",
    "Опционально": "Optional",
    "Есть": "Yes",
    "Нет": "No",
    "В комплекте": "Included",
    "Входит в комплект": "Included in the kit",
    "Значения": "Values",
    "значение": "value",
    "параметр": "parameter",
    "температура": "temperature",
    "давление": "pressure",
    "диапазон": "range",
    "материал": "material",
    "масса": "weight",
    "тип": "type",
    "шт": "pcs",
    "мм": "mm",
    "см": "cm",
    "м": "m",
    "кг": "kg",
    "г": "g",
    "л": "l",
    "с": "s",
    "мин": "min",
    "ч": "h",
    "мПа": "MPa",
    "кПа": "kPa",
    "бар": "bar",
    "°С": "°C",
    "°C": "°C",
}


def norm(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def add_pair(store, ru, en):
    ru, en = norm(ru), norm(en)
    if not ru or not en or not CYR.search(ru) or len(ru) > 240:
        return
    store.setdefault(ru, Counter())[en] += 1


def walk(store, item):
    add_pair(store, item.get("titleRu"), item.get("titleEn"))
    add_pair(store, item.get("scopeRu"), item.get("scopeEn"))
    add_pair(store, item.get("introRu"), item.get("introEn"))
    add_pair(store, item.get("nameRu"), item.get("nameEn"))
    for row in item.get("rows") or []:
        add_pair(store, row.get("labelRu"), row.get("labelEn"))
        add_pair(store, row.get("subRu"), row.get("subEn"))
        for cell in row.get("cells") or []:
            add_pair(store, cell.get("ru"), cell.get("en"))
    for fig in item.get("figures") or []:
        add_pair(store, fig.get("captionRu"), fig.get("captionEn"))
        add_pair(store, fig.get("noteRu"), fig.get("noteEn"))
    for group in item.get("tagGroups") or []:
        add_pair(store, group.get("scopeRu"), group.get("scopeEn"))


def main():
    seed = json.loads((BASE / "seed.json").read_text(encoding="utf-8"))
    store = {}
    for project in seed.get("projects") or []:
        for device in project.get("devices") or []:
            for page in device.get("pages") or []:
                walk(store, page)
            for kit in device.get("kits") or []:
                walk(store, kit)

    pairs = {}
    for ru, counter in store.items():
        words = ru.split()
        single = len(words) == 1
        best = None
        best_score = -1
        for en, count in counter.items():
            score = count * 10 + (3 if single and len(en.split()) == 1 else 0)
            if score > best_score:
                best, best_score = en, score
        if best:
            pairs[ru] = best

    for ru, en in EXTRA.items():
        pairs[norm(ru)] = norm(en)

    lowered = {}
    for ru, en in pairs.items():
        key = ru.lower()
        lowered.setdefault(key, {}).setdefault(en, 0)
        lowered[key][en] += 1
    table = {}
    for ru, counter in lowered.items():
        table[ru] = max(counter.items(), key=lambda kv: kv[1])[0]

    table = dict(sorted(table.items(), key=lambda kv: (-len(kv[0]), kv[0])))
    payload = {
        "version": 1,
        "source": "seed.json + глоссарий КИП",
        "pairs": table,
    }
    js = "window.DSDICT = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(js, encoding="utf-8")
    singles = sum(1 for key in table if len(key.split()) == 1)
    print(json.dumps({
        "dict_js_bytes": OUT.stat().st_size,
        "pairs": len(table),
        "single_words": singles,
        "multi_words": len(table) - singles,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
