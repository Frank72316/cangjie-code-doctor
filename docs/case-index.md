# 30例案例阅读与复核目录

2026-11-17 自建教学案例，Codex 辅助准备。不是采集的真实学生作业；尚未冻结。每份源码的题意与公开测试见 [catalog.json](../data/cases/catalog.json)，执行证据见 [案例准备说明](case-preparation.md)。

## 开发集（10例）

| 编号 | 类型 | 内容 | 预定初始行为 |
| --- | --- | --- | --- |
| [type_mismatch](../examples/type_mismatch.cj) | 类型 | 整数变量类型不匹配 | 编译报错 |
| [undefined_name](../examples/undefined_name.cj) | 作用域/接口 | 使用未声明变量 | 编译报错 |
| [argument_count](../examples/argument_count.cj) | 作用域/接口 | 函数缺少实参 | 编译报错 |
| [hello](../examples/hello.cj) | 正确回归 | 正常输出回归 | 公开测试通过 |
| [dev_string_quote](../data/cases/sources/dev_string_quote.cj) | 语法 | 字符串引号未闭合 | 编译报错 |
| [dev_dangling_else](../data/cases/sources/dev_dangling_else.cj) | 语法 | 孤立的 else 分支 | 编译报错 |
| [dev_immutable](../data/cases/sources/dev_immutable.cj) | 类型 | 修改不可变绑定 | 编译报错 |
| [dev_compare_bool](../data/cases/sources/dev_compare_bool.cj) | 类型 | 布尔变量接收数值 | 编译报错 |
| [dev_rectangle](../data/cases/sources/dev_rectangle.cj) | 逻辑 | 矩形周长公式 | 可编译，但公开输出错误 |
| [dev_square](../data/cases/sources/dev_square.cj) | 正确回归 | 平方函数正确回归 | 公开测试通过 |

## 评估候选集（20例，不用于调提示或检索参数）

| 编号 | 类型 | 内容 | 预定初始行为 |
| --- | --- | --- | --- |
| [eval_parameter_colon](../data/cases/sources/eval_parameter_colon.cj) | 语法 | 形参类型标记 | 编译报错 |
| [eval_argument_separator](../data/cases/sources/eval_argument_separator.cj) | 语法 | 实参分隔符 | 编译报错 |
| [eval_array_delimiter](../data/cases/sources/eval_array_delimiter.cj) | 语法 | 数组字面量括号 | 编译报错 |
| [eval_block_end](../data/cases/sources/eval_block_end.cj) | 语法 | 循环块缺少闭合 | 编译报错 |
| [eval_return_type](../data/cases/sources/eval_return_type.cj) | 类型 | 返回值类型与声明冲突 | 编译报错 |
| [eval_bool_arithmetic](../data/cases/sources/eval_bool_arithmetic.cj) | 类型 | 布尔值参与加法 | 编译报错 |
| [eval_condition_type](../data/cases/sources/eval_condition_type.cj) | 类型 | 整数作为条件 | 编译报错 |
| [eval_array_element](../data/cases/sources/eval_array_element.cj) | 类型 | 数组元素类型冲突 | 编译报错 |
| [eval_unknown_function](../data/cases/sources/eval_unknown_function.cj) | 作用域/接口 | 调用函数名不一致 | 编译报错 |
| [eval_block_scope](../data/cases/sources/eval_block_scope.cj) | 作用域/接口 | 块外访问局部变量 | 编译报错 |
| [eval_unknown_member](../data/cases/sources/eval_unknown_member.cj) | 作用域/接口 | 调用不存在的成员 | 编译报错 |
| [eval_loop_scope](../data/cases/sources/eval_loop_scope.cj) | 作用域/接口 | 循环控制语句位置 | 编译报错 |
| [eval_maximum](../data/cases/sources/eval_maximum.cj) | 逻辑 | 最大值分支颠倒 | 可编译，但公开输出错误 |
| [eval_absolute](../data/cases/sources/eval_absolute.cj) | 逻辑 | 负数绝对值 | 可编译，但公开输出错误 |
| [eval_accumulation](../data/cases/sources/eval_accumulation.cj) | 逻辑 | 累加终点遗漏 | 可编译，但公开输出错误 |
| [eval_leap_year](../data/cases/sources/eval_leap_year.cj) | 逻辑 | 闰年世纪规则 | 可编译，但公开输出错误 |
| [eval_clamp](../data/cases/sources/eval_clamp.cj) | 正确回归 | 范围截断正确回归 | 公开测试通过 |
| [eval_gcd](../data/cases/sources/eval_gcd.cj) | 正确回归 | 最大公约数正确回归 | 公开测试通过 |
| [eval_even](../data/cases/sources/eval_even.cj) | 正确回归 | 偶数判断正确回归 | 公开测试通过 |
| [eval_array_sum](../data/cases/sources/eval_array_sum.cj) | 正确回归 | 数组求和正确回归 | 公开测试通过 |

## 交叉复核时需要做什么

1. 两名成员分别核对题意、错误类别和家族划分，确认没有把原题变体分到开发与评估两边。按实际姓名和日期登记，当前均未代填。
2. 对照本地 `data/holdout/reference-drafts/` 中同名参考草稿检查算法及一般行为；草稿不能直接视作标准答案。参考实现与原程序的行为分别验证。
3. 对评估题另设独立函数调用与正常/边界测试；不要重复运行无输入的公开 main 冒充保留覆盖。保留材料不得上传或进入检索、生成和候选筛选界面。
4. 初始行为验收只确定原题是否按预期报错或输出；不能据此宣称修复成功或模型有效。完成上述复核及隔离验收后，才登记保留测试承诺和冻结版本。

原有开题目标仍为16个错误评估案例与4个正确回归案例；后者不进入修复率分母。当前全部是小规模自建题，对真实学生错误的代表性仍需后续补充。
