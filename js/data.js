// 初期店舗データ(サンプル)
// ここに登録している店名・エリアは公開情報をもとにした参考情報です。
// 住所・設置台数・営業状況などは変更されている可能性があるため、
// 実際に訪問する前に必ず最新情報をご確認ください。
// 「店舗を管理」から自由に追加・編集・削除できます。
const SEED_SHOPS = [
  { name: "マルハン梅田店", area: "osaka", city: "大阪市北区(梅田)" },
  { name: "マルハンなんば本館", area: "osaka", city: "大阪市中央区(千日前・難波)" },
  { name: "マルハンなんば新館", area: "osaka", city: "大阪市中央区(難波)" },
  { name: "マルハン新世界店", area: "osaka", city: "大阪市浪速区(恵美須東)" },
  { name: "マルハン東大阪店", area: "osaka", city: "東大阪市(御厨東)" },
  { name: "マルハンメガシティ堺店", area: "osaka", city: "堺市西区" },
  { name: "マルハン原山台店", area: "osaka", city: "堺市南区" },
  { name: "ダイナム大阪貝塚店 ゆったり館", area: "osaka", city: "貝塚市" },
  { name: "ダイナム泉佐野店", area: "osaka", city: "泉佐野市" },
  { name: "マルハン大安寺店", area: "nara", city: "奈良市(大安寺)" },
  { name: "マルハン橿原北店", area: "nara", city: "橿原市" },
  { name: "ダイナム奈良天理店 ゆったり館", area: "nara", city: "天理市" },
  { name: "ダイナム奈良桜井店 ゆったり館", area: "nara", city: "桜井市" },
  { name: "トリプルスター生駒", area: "nara", city: "生駒市(北新町)" },
  { name: "トリプルスター生駒プラス", area: "nara", city: "生駒市(北新町)" },
  { name: "エースII", area: "nara", city: "生駒市(鹿畑町)" },
  { name: "サイバーパチンコ大和小泉店", area: "nara", city: "大和郡山市(小林町)" },
];
