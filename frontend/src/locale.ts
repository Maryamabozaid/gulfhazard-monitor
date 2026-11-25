const codes: Record<string, string> = {
  "Saudi Arabia": "SA",
  "United Arab Emirates": "AE",
  Iraq: "IQ",
  Kuwait: "KW",
  Jordan: "JO",
  Bahrain: "BH",
  Qatar: "QA",
  Oman: "OM",
  Yemen: "YE",
  Egypt: "EG",
  Iran: "IR",
  Syria: "SY",
  Sudan: "SD",
  Eritrea: "ER",
  Ethiopia: "ET",
  Djibouti: "DJ",
  Somalia: "SO",
  Israel: "IL",
  Palestine: "PS",
  Pakistan: "PK",
  India: "IN",
};
const names = new Intl.DisplayNames(["ar"], { type: "region" });
export const placeName = (s: string, arabic: boolean) =>
  !arabic
    ? s
    : s === "Offshore"
      ? "عرض البحر"
      : codes[s]
        ? names.of(codes[s]) || s
        : s;
const translations: Record<string, string> = {
  "No observations in the requested region and dates.":
    "لا توجد مشاهدات ضمن المنطقة والفترة المحددتين.",
  "Refreshing the dated provider capture.": "جار تحديث نسخة المصدر المؤرخة.",
  "Showing a dated provider capture.": "تُعرض نسخة مؤرخة من المصدر.",
  "Public NOAA-20 feed covers the most recent seven days.":
    "يغطي مصدر NOAA-20 العام الأيام السبعة الأخيرة.",
  "Provider could not supply a valid response.":
    "تعذّر الحصول على استجابة صالحة من المصدر.",
  "Provider connection timed out or failed.":
    "تعذّر الاتصال بالمصدر أو انتهت مهلته.",
  "Some NOAA stations were unavailable.": "تعذّر الوصول إلى بعض محطات NOAA.",
  "FIRMS history limited to the last 30 requested days per query.":
    "يقتصر سجل FIRMS في كل طلب على آخر ثلاثين يوماً من الفترة المحددة.",
  "USGS unavailable. Showing the EMSC catalogue.":
    "تعذّر الوصول إلى USGS. يُعرض فهرس EMSC.",
  "Result capped at 3,000 polygons. Narrow the date range.":
    "بلغت النتيجة حد ٣٠٠٠ مضلع. اختر فترة أقصر.",
  "Historical FIRMS queries require FIRMS_MAP_KEY on the server.":
    "تتطلب بيانات FIRMS التاريخية إعداد FIRMS_MAP_KEY على الخادم.",
  "OpenSky supplies current regional activity only.":
    "يوفّر OpenSky النشاط الإقليمي الحالي فقط.",
  "Latest seven requested days, daily city model samples.":
    "عينات نموذجية يومية للمدن ضمن الأيام السبعة الأخيرة المطلوبة.",
  "Showing the available cached coverage.":
    "تُعرض التغطية المتوفرة من النسخة المخزنة.",
};
export function sourceMessage(message: string, arabic: boolean) {
  if (!arabic) return message;
  if (translations[message]) return translations[message];
  const parts = message.match(/[^.]+\.(?:\s|$)|[^.]+$/g);
  return (parts || [message])
    .map(
      (p) =>
        translations[p.trim()] ||
        p
          .trim()
          .replace(
            /^Provider returned HTTP (\d+)\./,
            "أعاد المصدر رمز HTTP $1.",
          ),
    )
    .join(" ");
}
